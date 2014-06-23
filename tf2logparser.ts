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

function inviteToGroup(invitee: string): void {
	// Need's the bot's web cookies
	/*bot.webLogOn(function(steamCookies: string[]): void {
		var j = requester.jar();
		j.setCookie(requester.cookie(steamCookies[0]), "http://steamcommunity.com");
		j.setCookie(requester.cookie(steamCookies[1]), "http://steamcommunity.com");
		requester.post({url: "http://steamcommunity.com/actions/GroupInvite", jar: j, form: {
			"type": "groupInvite",
			"inviter": bot.steamID,
			"invitee": invitee,
			"group": DogeTipGroupID, // Dogecoin group
			"sessionID": (/sessionid=(.*)/).exec(steamCookies[0])[1]
		}}, function (err, httpResponse, body) {
			Collections.Errors.insert({
				"timestamp": Date.now(),
				"time": new Date().toString(),
				"type": "Invite Response",
				"info": {
					err: err,
					httpResponse: httpResponse,
					body: body
				}
			}, {w:0}, undefined);
		});
	});*/
}
function connectToRCON() {
	rcon = new RCON({"address": credentials.tf2.ip + ":" + credentials.tf2.port, "password": credentials.tf2.rcon});
	rcon.connect();
}
connectToRCON();
function sendBigMessage(message: string): void {
	rcon.runCommand("sm_hsay " + message);
}
function sendMessage(message: string): void {
	rcon.runCommand("say " + message);
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
			// They're moving from another team
			// If they've made a wager, move them back
			// sm_ts <name> [index] - Swap a player's team or move a player to team [index]. (1=spec, 2=red, 3=blue)
			Collections.Wagers.findOne({"decided": false, "player.id": steamID}, function(err, previousWager) {
				if (err) {
					console.error(err);
					// No need to notify
					return;
				}
				if (previousWager) {
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
				sendMessage("The Doge Tip group can be found at http://steamcommunity.com/groups/DogeTip");
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
						"timestamp": Date.now(),
						"string": new Date().toString()
					}
				}, {w:1}, function(err: Error) {
					if (err) {
						console.error(err);
						sendMessage("Sorry, an error occurred");
						return;
					}
					var printTeam: string = (team === "red") ? "Red" : "Blu";
					sendMessage(name + " has wagered " + amount + " DOGE on a win for the " + printTeam + " team!");
				});
				break;
			default:
				sendMessage("I couldn't understand your command");
		}
	}
	var roundWinParsed: any[] = roundWinRegEx.exec(line);
	if (roundWinParsed) {
		var winningTeam = roundWinParsed[1]; // "Red" or "Blue"
		// Stuff
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