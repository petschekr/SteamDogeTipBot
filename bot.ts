/// <reference path="typescript_defs/node.d.ts" />
/// <reference path="typescript_defs/mongodb.d.ts" />
import mongodb = require("mongodb");

var fs = require("fs");
var crypto = require("crypto");
var MongoClient = require("mongodb").MongoClient;
var Steam = require("steam");
var dogecoin = require('node-dogecoin')()

var credentials: {
	steam: {
		accountName?: string;
		password?: string;
		shaSentryfile?: any; // Buffer
	};
	rpc: {
		username?: string;
		password?: string;
	};
} = {steam: {}, rpc: {}};
var rawCredentials = JSON.parse(fs.readFileSync("auth.json", {"encoding": "utf8"}));
credentials.steam.accountName = rawCredentials.steam.accountName;
credentials.steam.password = rawCredentials.steam.password;
credentials.steam.shaSentryfile = new Buffer(rawCredentials.steam.shaSentryfile, "hex");
credentials.rpc.username = rawCredentials.rpc.username;
credentials.rpc.password = rawCredentials.rpc.password;

// Connect to Dogecoin daemon
dogecoin.auth(credentials.rpc.username, credentials.rpc.password);

var DogeTipGroupID: string = "103582791435182182";

MongoClient.connect("mongodb://localhost:27017/dogebot", function(err: any, db: mongodb.Db) {
if (err)
	throw err
var Collections: {
	Users: mongodb.Collection;
	Tips: mongodb.Collection;
	Transactions: mongodb.Collection;
	Errors: mongodb.Collection;
} = {
	Users: db.collection("users"),
	Tips: db.collection("tips"),
	Transactions: db.collection("transactions"),
	Errors: db.collection("errors"),
};

var bot = new Steam.SteamClient();
bot.logOn(credentials.steam);
bot.on("loggedOn", function(): void {
	console.log("Logged in as " + credentials.steam.accountName);
	bot.setPersonaState(Steam.EPersonaState.Online) // to display your bot's status as "Online"
	console.log("SteamID: " + bot.steamID);
	
	bot.joinChat(DogeTipGroupID);
	bot.sendMessage(DogeTipGroupID, "dogetippingbot is back online");
});

function getNameFromID(steamID: string): string {
	if (bot.users[steamID])
		return bot.users[steamID].playerName;
	else
		return undefined;
}
function reportError(err: any, context: string, justID: boolean = false) {
	var errorID: string = crypto.randomBytes(16).toString("hex");
	Collections.Errors.insert({
		"id": errorID,
		"timestamp": Date.now(),
		"time": new Date().toString(),
		"error": err,
		"context": context || "No context reported"
	}, {w:0}, function(): void {});
	if (justID) {
		return errorID;
	} else {
		return "An error occurred! Don't worry, it has been reported. To receive support with this error, please include the error code of '" + errorID + "'. Sorry for the inconvenience.";
	}
};

bot.on("chatMsg", function(sourceID: string, message: string, type: number, chatterID: string): void {
	if (message[0] === "+") {
    	switch (message) {
			case "+me":
				bot.sendMessage(DogeTipGroupID, bot.users[chatterID].playerName);
				bot.sendMessage(DogeTipGroupID, chatterID);
				break;
			case "+stats":
				bot.sendMessage(DogeTipGroupID, "0 users have registered and tipped other shibes 0 times");
				break;
			default:
				bot.sendMessage(DogeTipGroupID, "I won't respond to commands on the group chat. Open up a private message by double clicking on my name in the sidebar to send me commands.");
    	}
  	}
});
bot.on("friendMsg", function(chatterID: string, message: string, type: number): void {
	// Private messages
	if (message === "")
		return;
	switch (message.split(" ")[0]) { // The command part
		case "+register":
			var name: string = getNameFromID(chatterID);

			Collections.Users.findOne({"id": chatterID}, function(err: Error, previousUser) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Checking for previous user in +register"));
					return;
				}
				if (previousUser) {
					bot.sendMessage(chatterID, "You've already registered");
					return;
				}

				dogecoin.getNewAddress(chatterID, function(err: Error, address: string) { // chatterID is that user's account
					if (err) {
						bot.sendMessage(chatterID, reportError(err, "Generating address for new user"));
						return;
					}
					var userEntry = {
						"id": chatterID,
						"name": name,
						"history": [],
						"address": address
					};
					Collections.Users.insert(userEntry, {w:1}, function(err: Error) {
						if (err) {
							bot.sendMessage(chatterID, reportError(err, "Adding new user to the database"));
						}
						bot.sendMessage(chatterID, "Welcome " + name + "!");
						bot.sendMessage(chatterID, "Your deposit address is " + address);
						bot.sendMessage(chatterID, "Tip users with '+tip <STEAM NAME> <AMOUNT> doge'");
						bot.sendMessage(chatterID, "If you need help, reply with '+help'");
					});
				});
			});
			break;
		case "+deposit":
		case "+add":
			Collections.Users.findOne({"id": chatterID}, function(err: Error, user) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving user in +add"));
					return;
				}
				if (!user) {
					bot.sendMessage(chatterID, "You must be registered to add funds");
					return;
				}
				bot.sendMessage(chatterID, "Your deposit address is " + user.address);
				bot.sendMessage(chatterID, "This address is locked to your account and will not change");
			});
			break;
		case "+balance":
			Collections.Users.findOne({"id": chatterID}, function(err: Error, user) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving user in +balance"));
					return;
				}
				if (!user) {
					bot.sendMessage(chatterID, "You must be registered to view your balance");
					return;
				}
				dogecoin.getBalance(chatterID, function(err: Error, balance: number) {
					if (err) {
						bot.sendMessage(chatterID, reportError(err, "Retrieving user balance in +balance"));
						return;
					}
					bot.sendMessage(chatterID, "Your current balance is " + balance + " DOGE");
					bot.sendMessage(chatterID, "Your deposit address is " + user.address);
				});
			});
			break;
		case "+history":
			break;
		case "+withdraw":
			Collections.Users.findOne({"id": chatterID}, function(err: Error, user) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving user in +withdraw"));
					return;
				}
				if (!user) {
					bot.sendMessage(chatterID, "You must be registered to withdraw your DOGE");
					return;
				}
				dogecoin.getBalance(chatterID, function(err: Error, balance: number) {
					if (err) {
						bot.sendMessage(chatterID, reportError(err, "Retrieving user balance in +withdraw"));
						return;
					}

					var sendToAddress: string = message.split(" ")[1];
					if (sendToAddress === undefined) {
						bot.sendMessage(chatterID, "Missing address. Notation for +withdraw is '+withdraw <ADDRESS> <AMOUNT|all> doge'.");
						return;
					}

					var rawAmount: string = message.split(" ")[2];
					var sendAmount: number = 0;
					if (rawAmount === undefined) {
						bot.sendMessage(chatterID, "Missing amount. Notation for +withdraw is '+withdraw <ADDRESS> <AMOUNT|all> doge'.");
						return;
					}
					if (rawAmount.toLowerCase() === "all") {
						sendAmount = balance;
					}
					else {
						sendAmount = parseFloat(rawAmount);
						if (isNaN(sendAmount) || sendAmount < 1) {
							bot.sendMessage(chatterID, "Invalid amount of DOGE to withdraw");
							return;
						}
					}

					dogecoin.sendFrom(chatterID, sendToAddress, sendAmount, function(err: any, txid: string) {
						// Full list of errors at https://github.com/dogecoin/dogecoin/blob/master/src/rpcprotocol.h#L43
						if (err) {
							if (err.code === -5) {
								bot.sendMessage(chatterID, "Invalid withdrawal address");
							}
							else if (err.code === -6) {
								bot.sendMessage(chatterID, "You have insufficient funds to withdraw that much DOGE");
								bot.sendMessage(chatterID, "Your current balance is " + balance + " DOGE");
							}
							else {
								bot.sendMessage(chatterID, reportError({code: err.code, id: chatterID, address: sendToAddress, amount: sendAmount}, "Withdrawing funds"));
							}
							return;
						}
						bot.sendMessage(chatterID, "Sent " + sendAmount + " DOGE to " + sendToAddress + " in tx " + txid);
						// Reimburse the user for their transaction fee of 1 DOGE
						dogecoin.move("FeePool", chatterID, 1, function(err: any, success: boolean) {
							if (err) {
								bot.sendMessage(chatterID, reportError(err, "Reimbursing the user for their transaction fee"));
								return;
							}
							bot.sendMessage(chatterID, "The transaction fee of 1 DOGE has been reimbursed")
						});
					});
				});
			});
			break;
		case "+help":
			break;
		case "+version":
			break;
		case "+tip":
			break;
		default:
			bot.sendMessage(chatterID, "I couldn't understand your request. Reply with '+help' for a list of available commands and functions.");
	}
});

bot.on("friend", function(steamID: string, relationship: number): void {
	if (relationship === Steam.EFriendRelationship.RequestRecipient) {
		bot.addFriend(steamID);
		setTimeout(function(): void {
			bot.sendMessage(steamID, "Go to the Doge Tip group to message me. I can't accept friend requests.");
			bot.sendMessage(steamID, "Removing friend...");
			setTimeout(function(): void {
				bot.removeFriend(steamID);
			}, 2000);
		}, 2000);
	}
});
bot.on("user", function(userInfo): void {});

});