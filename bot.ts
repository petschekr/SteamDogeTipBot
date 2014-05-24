/// <reference path="typescript_defs/node.d.ts" />
/// <reference path="typescript_defs/mongodb.d.ts" />
import mongodb = require("mongodb");

var fs = require("fs");
var crypto = require("crypto");
var MongoClient = require("mongodb").MongoClient;
var Steam = require("steam");
var dogecoin = require("node-dogecoin")()
var async = require("async");

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
						"address": address
					};
					Collections.Users.insert(userEntry, {w:1}, function(err: Error) {
						if (err) {
							bot.sendMessage(chatterID, reportError(err, "Adding new user to the database"));
						}
						bot.sendMessage(chatterID, "Welcome " + name + "!");
						bot.sendMessage(chatterID, "Your deposit address is: " + address);
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
				bot.sendMessage(chatterID, "Your deposit address is: " + user.address);
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
					bot.sendMessage(chatterID, "Your current balance is: " + balance + " DOGE");
					bot.sendMessage(chatterID, "Your deposit address is: " + user.address);
				});
			});
			break;
		case "+history":
			Collections.Users.findOne({"id": chatterID}, function(err: Error, user) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving user in +history"));
					return;
				}
				if (!user) {
					bot.sendMessage(chatterID, "You must be registered to view your history");
					return;
				}
				var numberOfTransactions: number = 10;
				async.parallel([
					function(callback) {
						dogecoin.getBalance(chatterID, callback);
					},
					function(callback) {
						// Get 20 most recent transactions because moves from the FeePool also count and must be expunged
						dogecoin.listTransactions(chatterID, numberOfTransactions * 2, callback);
					}
				], function(err: any, results: any) {
					if (err) {
						bot.sendMessage(chatterID, reportError(err, "async.parallel in +history"));
						return;
					}
					var balance: number = results[0];
					var rawTransactions: any[] = results[1];
					var transactions: any[] = [];
					// Purge tx fee reimbursements
					for (var i: number = 0; i < rawTransactions.length; i++) {
						if (rawTransactions[i].category === "move" && rawTransactions[i].otheraccount === "FeePool") {
							continue;
						}
						transactions.unshift(rawTransactions[i]);
					}
					var message: string = "\n" + user.name + ", here are your last 10 transactions:\n";
					message += "Your current balance is: " + balance + " DOGE\n";
					message += "Your deposit address is: " + user.address + "\n";
					for (var i: number = 0; i < transactions.length; i++) {
						var transaction: any = transactions[i];
						switch (transaction.category) {
							case "move":
								message += "\n\tType: move";
								break;
							case "send":
								message += "\n\tType: withdraw, Amount: " + Math.abs(transaction.amount) + ", Address: " + transaction.address + ", Confirmations: " + transaction.confirmations;
								break;
							case "receive":
								message += "\n\tType: deposit, Amount: " + Math.abs(transaction.amount) + ", Confirmations: " + transaction.confirmations;
								break;
						}
						var time: Date = new Date(transaction.time * 1000); // Dogecoind returns a time that is missing the last 3 digits so multiplying by 1000 fixes this
						message += ", Date: " + time.toDateString() + " (EST)";
					}
					bot.sendMessage(chatterID, message);
				});
			});
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
					}
					if (isNaN(sendAmount) || sendAmount < 1) {
						bot.sendMessage(chatterID, "Invalid amount of DOGE to withdraw");
						return;
					}

					dogecoin.sendFrom(chatterID, sendToAddress, sendAmount, function(err: any, txid: string) {
						// Full list of errors at https://github.com/dogecoin/dogecoin/blob/master/src/rpcprotocol.h#L43
						if (err) {
							if (err.code === -5) {
								bot.sendMessage(chatterID, "Invalid withdrawal address");
							}
							else if (err.code === -4) {
								// Wallet probably doesn't have enough funds
								reportError({message: "Insufficient server funds to complete withdrawal request", id: chatterID, address: sendToAddress, amount: sendAmount}, "Withdrawing funds");
								bot.sendMessage(chatterID, "Sorry, the server doesn't have enough funds currently to complete that request. Most of the server's funds are kept offline in cold wallets to increase security. This bot's maintainer (RazeTheRoof) has been notified of the server's insufficient balance. He will fix this shortly. If this problem persists, please don't hesitate to email him at <petschekr@gmail.com>.");
							}
							else if (err.code === -6) {
								bot.sendMessage(chatterID, "You have insufficient funds to withdraw that much DOGE");
								bot.sendMessage(chatterID, "Your current balance is: " + balance + " DOGE");
							}
							else {
								bot.sendMessage(chatterID, reportError({code: err.code, id: chatterID, address: sendToAddress, amount: sendAmount}, "Withdrawing funds"));
							}
							return;
						}
						bot.sendMessage(chatterID, "Sent " + sendAmount + " DOGE to " + sendToAddress + " in tx " + txid);
						// Reimburse the user for their transaction fee
						dogecoin.getTransaction(txid, function(err: any, txInfo: any) {
							if (err) {
								bot.sendMessage(chatterID, reportError(err, "Retrieving tx info in +withdraw"));
								return;
							}
							var fee: number = Math.abs(txInfo.fee);
							if (fee === 0) {
								bot.sendMessage(chatterID, "The transaction fee was 0 DOGE");
								return;
							}
							dogecoin.move("FeePool", chatterID, fee, function(err: any, success: boolean) {
								if (err) {
									bot.sendMessage(chatterID, reportError(err, "Reimbursing the user for their transaction fee"));
									return;
								}
								bot.sendMessage(chatterID, "The transaction fee of " + fee + " DOGE has been reimbursed")
							});
						});
					});
				});
			});
			break;
		case "+help":
			var helpMessage: string = 
				[
					"Hello there. I'm dogetippingbot.",
					"New to Dogecoin? Visit the official page: http://www.dogecoin.com",
					"",
					"Commands:",
					"	+register - Notify the bot that you exist. You will be added to the database and will receive a deposit address",
					"	+deposit - View your deposit address",
					"	+balance - Check the amount of DOGE in your account",
					"	+history - Display your current balance and a list of your 10 most recent transactions",
					"	+withdraw <ADDRESS> <AMOUNT|all> doge - Withdraw funds in your account to the specified address (the 1 DOGE transaction fee will be covered by the bot",
					"	+tip <STEAM NAME|#STEAMIDNUMBER> <AMOUNT|all> doge [+verify] - Send a Steam user a tip. Currently, this will fail if they haven't registered with the bot. If +verify is added, the bot will send a message confirming the tip to the group chat.",
					"	+donate <AMOUNT> doge - Donate doge to the developer to keep the bot alive. The server costs about 17,000 DOGE a month. Any help is greatly appreciated!",
					"	+version - Current bot version",
					"	+help - This help dialog",
					"",
					"Find a bug? Want a feature? File an issue at https://github.com/petschekr/SteamDogeTipBot/issues or submit a pull request",
					"Need anything else? Email me at <petschekr@gmail.com>"
				].join("\n");
			bot.sendMessage(chatterID, helpMessage);
			break;
		case "+version":
			bot.sendMessage(chatterID, "DogeTippingBot v2.0.0 by Ryan Petschek (RazeTheRoof) <petschekr@gmail.com>\nDonate to D7uWLJKtS5pypUDiHjRj8LUgn9oPHrzv7b if you enjoy this bot and want keep it running. Servers cost money!");
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
bot.on("user", function(userInfo): void {
	Collections.Users.findOne({"id": userInfo.friendid}, function(err: Error, user) {
		if (err) {
			reportError(err, "Retrieving user in user change handler");
			return;
		}
		if (!user)
			return;
		if (user.name !== userInfo.playerName) {
			// If the name was changed, update it in the database
			Collections.Users.update({"id": userInfo.friendid}, {$set: {"name": userInfo.playerName}}, {w:1}, function(err: Error) {
				reportError(err, "Changing player's name in user change handler");
			});
		}
	});
});

});