/// <reference path="typescript_defs/node.d.ts" />
/// <reference path="typescript_defs/mongodb.d.ts" />
import mongodb = require("mongodb");

var fs = require("fs");
var BigIntLib = require("./biginteger");
var dgram = require("dgram");
var server = dgram.createSocket("udp4");
var moment = require("moment");
var numeral = require("numeral");
var RCON = require("srcds-rcon");
var MongoClient = require("mongodb").MongoClient;
var dogecoin = require("node-dogecoin")()
var requester = require("request");
var async = require("async");

var credentials = JSON.parse(fs.readFileSync("auth.json", {"encoding": "utf8"}));
// Connect to TF2 server via RCON
var rcon: any;
// Connect to Dogecoin daemon
dogecoin.auth(credentials.rpc.username, credentials.rpc.password);
// Connect to MongoDB
MongoClient.connect("mongodb://localhost:27017/dogebot", function(err: any, db: mongodb.Db) {
if (err)
	throw err
var Collections: {
	Users: mongodb.Collection;
	Tips: mongodb.Collection;
	Errors: mongodb.Collection;
	Wagers: mongodb.Collection;
} = {
	Users: db.collection("users"),
	Tips: db.collection("tips"),
	Errors: db.collection("errors"),
	Wagers: db.collection("wagers")
};
var DogeTipGroupID: string = "103582791435182182";

function getHTTPPage(url: string, callback: (err: Error, content: string) => void): void {
	requester(url, function (err, response, body) {
		if (err) {
			err.URL = url;
			callback(err, null);
			return;
		}
		callback(null, body);
	});
}
var prices = {
	"BTC/USD": null,
	"DOGE/BTC": null,
	"DOGE/USD": null,
	"LastUpdated": null
};
function getPrices(): void {
	async.parallel([
		function(callback) {
			// Coinbase BTC/USD price
			getHTTPPage("https://coinbase.com/api/v1/currencies/exchange_rates", callback);
		},
		function(callback) {
			// Mintpal DOGE/BTC price
			getHTTPPage("https://api.mintpal.com/v1/market/stats/DOGE/BTC", callback);
		}
	], function(err: Error, results: any[]): void {
		if (err) {
			console.trace(err);
			return;
		}
		try {
			prices["BTC/USD"] = parseFloat(JSON.parse(results[0])["btc_to_usd"]);
			prices["DOGE/BTC"] = parseFloat(JSON.parse(results[1])[0].last_price);
		}
		catch(e) {
			return;
		}
		prices["DOGE/USD"] = prices["BTC/USD"] * prices["DOGE/BTC"];
		// Return to strings with .toFixed(8)
		prices.LastUpdated = Date.now();
	});
}
getPrices();
// Both API's are updated every minute so update every 5 minutes
setInterval(getPrices, 1000 * 60 * 5);

function stringifyAndEscape(object: any): string {
	return JSON.stringify(object).replace(/[\u0080-\uFFFF]/g, function(m) {
		return "\\u" + ("0000" + m.charCodeAt(0).toString(16)).slice(-4);
	});
}
function inviteToGroup(invitee: string): void {
	fs.readFile("cookies.json", {encoding: "utf8"}, function(err, data: string) {
		var steamCookies: string[] = JSON.parse(data);
		var j = requester.jar();
		j.setCookie(requester.cookie(steamCookies[0]), "http://steamcommunity.com");
		j.setCookie(requester.cookie(steamCookies[1]), "http://steamcommunity.com");
		requester.post({url: "http://steamcommunity.com/actions/GroupInvite", jar: j, form: {
			"type": "groupInvite",
			"inviter": "76561198126817377", // Bot's SteamID
			"invitee": invitee,
			"group": DogeTipGroupID, // Dogecoin group
			"sessionID": (/sessionid=(.*)/).exec(steamCookies[0])[1]
		}});
	});
}
function connectToRCON() {
	rcon = new RCON({"address": credentials.tf2.ip + ":" + credentials.tf2.port, "password": credentials.tf2.rcon});
	rcon.on("error", function(err): void {
		console.error("RCON error: ", err);
	});
	rcon.connect();
}
connectToRCON();
function sendBigMessage(message: string): void {
	rcon.runCommand("sm_hsay " + message);
}
function sendMessage(message: string): void {
	rcon.runCommand("say " + message);
}
function sendPrivateMessage(id: string, message: string): void {
	id = getServerSteamID(id, true);
	rcon.runCommand("sm_psay #" + id + " \"" + message + "\"");
}

var teams: {
	red: any[];
	blue: any[];
} = {
	"red": [],
	"blue": []
}
var wagersCanBePlaced: boolean = false;

function parseLine(line: string): void {
	var timeRegEx: RegExp = /L (\d\d\/\d\d\/\d\d\d\d - \d\d:\d\d:\d\d):/;
	var joinServerRegEx: RegExp = /"(.+?)<\d+><(STEAM_\d:\d:\d+)><(.*?)>" joined team "(Red|Blue)"/;
	var disconnectedRegEx: RegExp = /"(.+?)<\d+><(STEAM_\d:\d:\d+)><(.*?)>" disconnected \(reason "(.*?)"\)/;
	var chatMessageRegEx: RegExp = /"(.+?)<\d+><(STEAM_\d:\d:\d+)><(.*?)>" say "(.*)"/;

	var roundWinRegEx: RegExp = /World triggered "Round_Win" \(winner "(Red|Blue)"\)/;
	var mapLoaded: RegExp = /Started map "(.*)"/;
	var roundStarted: RegExp = /World triggered "Round_Start"/;
	var setupEnded: RegExp = /World triggered "Round_Setup_End"/;

	var time: Date = moment(timeRegEx.exec(line)[1], "MM/DD/YYYY - HH:mm:ss").toDate();

	var joinServerParsed: any[] = joinServerRegEx.exec(line);
	if (joinServerParsed) {
		var fromTeam: string = joinServerParsed[3];
		var team: string = joinServerParsed[4].toLowerCase();
		var steamID: string = getSteamID(joinServerParsed[2]);
		var name: string = joinServerParsed[1];
		if (fromTeam === "Unassigned") {
			// Just joined server
			teams[team].push({
				"steamID": steamID,
				"name": name,
				"team": team
			});
		}
		else {
			// Don't move them for becoming a spectator (might've happened because of the AFK plugin)
			if (team === "spectator")
				return;
			// They're moving from another team
			// If they've made a wager, move them back
			// sm_ts <name> [index] - Swap a player's team or move a player to team [index]. (1=spec, 2=red, 3=blue)
			Collections.Wagers.findOne({"decided": false, "player.id": steamID}, function(err, previousWager) {
				if (err) {
					console.trace(err);
					// No need to notify
					return;
				}
				if (previousWager && previousWager.player.team !== team) {
					// Move back to previous team
					sendMessage(name + " tried to switch to the other team after placing a wager!");
					var switchToIndex: number = (previousWager.player.team === "red") ? 2 : 3;
					rcon.runCommand("sm_ts " + name + " " + switchToIndex);
				}
			});
		}
	}
	var chatMessageParsed: any[] = chatMessageRegEx.exec(line);
	if (chatMessageParsed) {
		// Handle commands
		var team: string = chatMessageParsed[3].toLowerCase();
		var message: string = chatMessageParsed[4].toLowerCase();
		var steamID: string = getSteamID(chatMessageParsed[2]);
		var name: string = chatMessageParsed[1];
		if (message[0] !== "+")
			return; // Not a wager command
		switch (message.split(" ")[0]) {
			case "+joingroup":
				// Invite them to the Doge Tip group
				sendPrivateMessage(steamID, "You have been sent a group invite to the Doge Tip group. Join its group chat to tip other shibes!");
				inviteToGroup(steamID);
				break;
			case "+register":
				sendPrivateMessage(steamID, "You've been sent a group invite to the Doge Tip group. Follow the instructions there to register (it should only take a few seconds).");
				inviteToGroup(steamID);
				break;
			case "+tip":
				sendMessage("Tipping functionality in the server chat is coming soon!");
				break;
			case "+bet":
			case "+wager":
				if (!wagersCanBePlaced) {
					sendMessage("Sorry " + name + ", wagers can't be placed after 2 minutes have elapsed");
					return;
				}
				var amount: number = numeral().unformat(message.split(" ")[1]);
				if (amount < 1) {
					sendMessage("Sorry " + name + ", you can't wager less than 1 DOGE");
					return;
				}
				Collections.Wagers.findOne({"decided": false, "player.id": steamID}, function(err, previousWager): void {
					if (err) {
						console.trace(err);
						return;
					}
					if (previousWager) {
						sendMessage("Sorry " + name + ", you've already wagered " + previousWager.amount + " DOGE on this match. Please wait until the next round to wager again.");
						return;
					}
					// Check if they have enough DOGE in their account
					dogecoin.getBalance(steamID, function(err, balance: number) {
						if (err) {
							console.trace(err);
							return;
						}
						if (balance < amount) {
							sendMessage("Sorry " + name + ", you don't have enough DOGE to make that wager");
							return;
						}
						// Take their wager
						var tipComment = {
							"sender": name,
							"recipient": "TF2 Wager",
							"refund": false,
							"USD": amount * prices["DOGE/USD"]
						};
						var teamWagerPool: string = (team === "red") ? "WagersRed" : "WagersBlu";
						dogecoin.move(steamID, teamWagerPool, amount, 1, stringifyAndEscape(tipComment), function(err: any, success: boolean) {
							if (err) {
								err.name = name;
								err.team = team;
								err.steamID = steamID;
								err.amount = amount;
								console.trace(err);
								return;
							}
							Collections.Wagers.insert({
								"player": {
									"id": steamID,
									"name": name,
									"team": team // Will be lowecase
								},
								"amount": amount,
								"decided": false,
								"won": null,
								"time": {
									"timestamp": time.valueOf(),
									"string": time.toString()
								}
							}, {w:1}, function(err: Error) {
								if (err) {
									console.trace(err);
									sendMessage("Sorry, an error occurred");
									return;
								}
								var printTeam: string = (team === "red") ? "Red" : "Blu";
								sendMessage(name + " has wagered " + amount + " DOGE on a win for the " + printTeam + " team!");
							});
						});
					});
				});
				break;
			default:
				sendMessage("I couldn't understand your command");
		}
	}
	var roundWinParsed: any[] = roundWinRegEx.exec(line);
	if (roundWinParsed) {
		var winningTeam = roundWinParsed[1].toLowerCase(); // "red" or "blue"
		async.parallel([
			function(callback) {
				dogecoin.getBalance("WagersRed", callback);
			},
			function(callback) {
				dogecoin.getBalance("WagersBlu", callback);
			}
		], function(err, balances: number[]) {
			var redWagerPool: number = balances[0];
			var bluWagerPool: number = balances[1];
			
			var wagerStream = Collections.Wagers.find({"decided": false}).stream();
			wagerStream.on("data", function(wager): void {
				var won: boolean = (wager.player.team === winningTeam);
				var teamWagerPool = (wager.player.team === "red") ? redWagerPool : bluWagerPool;
				if (won) {
					// Won their bet
					var winnings: number = (wager.amount / teamWagerPool) * (redWagerPool + bluWagerPool);
					var tipComment = {
						"sender": "TF2 Wager",
						"recipient": wager.player.name,
						"refund": false,
						"USD": winnings * prices["DOGE/USD"]
					};
					dogecoin.move("WagersRed", wager.player.id, winnings, 1, stringifyAndEscape(tipComment), function(err: any, success: boolean) {
						if (err) {
							err.player = wager.player;
							err.amount = wager.amount;
							console.trace(err);
							return;
						}
						sendPrivateMessage(wager.player.id, "You've won " + winnings + " DOGE on your wager of " + wager.amount + " DOGE!");
					});
				}
				Collections.Wagers.update({"_id": wager["_id"]}, {$set: {"won": won, "decided": true}}, {w:0}, undefined);
			});
			wagerStream.on("end", function(): void {
				sendMessage("Wager winnings have been paid out to the " + roundWinParsed[1] + " team!");
				// Wagers are always paid out from the red wager pool account so move the remaining blu funds to make both accounts have a balance of 0
				dogecoin.getBalance("WagersBlu", function(err, bluBalance: number): void {
					if (bluBalance <= 0)
						return;
					dogecoin.move("WagersBlu", "WagersRed", bluBalance, function(err, success: boolean) {
						if (err) {
							console.trace(err);
						}
					});
				});
			});
		});
	}
	if (mapLoaded.exec(line)) {
		wagersCanBePlaced = true;
		connectToRCON();
	}
	if (roundStarted.exec(line)) {
		wagersCanBePlaced = true;
		sendBigMessage("You have 2 minutes to make wagers on this match!");
		// Set a 2 minute period for making wagers
		setTimeout(function(): void {
			sendBigMessage("1 minute left to make wagers!");
			setTimeout(function(): void {
				sendBigMessage("The wager period has ended!");
				wagersCanBePlaced = false;
			}, 1000 * 60);
		}, 1000 * 60);
	}
}
function getSteamID(TF2ID: string) {
	var ID_ADDEND = new BigIntLib.BigInteger("76561197960265728");
	var matches = TF2ID.match(/^STEAM_(\d):(\d):(\d+)$/);
	if (matches && matches.length > 0) {
		var server = new BigIntLib.BigInteger(matches[2]), authId = new BigIntLib.BigInteger(matches[3]);
		return authId.multiply(new BigIntLib.BigInteger('2')).add(ID_ADDEND).add(server).toString();
	}
	return null;
}
function getServerSteamID(friendID: string, chatSafe: boolean = false) {
	var ID_ADDEND = new BigIntLib.BigInteger("76561197960265728");
	var matches = friendID.match(/^\d+$/)
	if (matches && matches.length > 0) {
		var id = new BigIntLib.BigInteger(friendID);
		var server = id.remainder(new BigIntLib.BigInteger('2')), authId = id.subtract(ID_ADDEND).subtract(server).divide(new BigIntLib.BigInteger('2'));
		if (!chatSafe) {
			// Formal IDs
			return "STEAM_0:" + server.toString() + ":" + authId;
		}
		else {
			// IDs that can be used to target users in RCON
			return "STEAM_0_" + server.toString() + "_" + authId;
		}
	}
}

// Line by line parsing transform stream
/*var stream = require("stream");
var liner = new stream.Transform({objectMode: true});
liner._transform = function (chunk, encoding, done: Function) {
	var data: string = chunk.toString();
	if (this._lastLineData)
		data = this._lastLineData + data;
	var lines = data.split("\n");
	this._lastLineData = lines.splice(lines.length - 1, 1)[0];

	lines.forEach(this.push.bind(this));
	done();
}
liner._flush = function (done: Function) {
	if (this._lastLineData)
		this.push(this._lastLineData);
	this._lastLineData = null;
	done();
}
// Parse the existing log file
var source = fs.createReadStream("tf2.log");
source.pipe(liner);
console.log("Parsing existing log file");
liner.on("readable", function(): void {
	var line: string;
	while (line = liner.read()) {
		
	}
});
liner.on("end", function(): void {
	console.log("Log file parsing complete");
});*/

var logStream = fs.createWriteStream("tf2.log", {"flags": "a", "encoding": "ascii"}); // Open in append mode
server.on("message", function (message, rinfo) {
	var msg = message.toString("ascii").slice(5, -1);    
	logStream.write(msg);
	parseLine(msg);
});

server.on("listening", function() {
	var address = server.address();
	console.log("UDP Server for TF2 logs listening on " + address.address + ":" + address.port);
});
server.bind(8006);

});