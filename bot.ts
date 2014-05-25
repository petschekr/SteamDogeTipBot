/// <reference path="typescript_defs/node.d.ts" />
/// <reference path="typescript_defs/mongodb.d.ts" />
import mongodb = require("mongodb");

var http = require("http");
var fs = require("fs");
var crypto = require("crypto");
var MongoClient = require("mongodb").MongoClient;
var Steam = require("steam");
var dogecoin = require("node-dogecoin")()
var async = require("async");
var cheerio = require("cheerio");

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
var donationAddress: string = "D7uWLJKtS5pypUDiHjRj8LUgn9oPHrzv7b";

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
					// Restrict to 10 transactions
					transactions.splice(numberOfTransactions, transactions.length);
					var message: string = "\n" + user.name + ", here are your last 10 transactions:\n";
					message += "Your current balance is: " + balance + " DOGE\n";
					message += "Your deposit address is: " + user.address + "\n";
					for (var i: number = 0; i < transactions.length; i++) {
						var transaction: any = transactions[i];
						switch (transaction.category) {
							case "move":
								try {
									JSON.parse(transaction.comment);
								}
								catch (e) {
									continue;
								}
								if (transaction.amount > 0) {
									// Received tip
									var sender: string = JSON.parse(transaction.comment).sender;
									message += "\n\tType: received tip, Amount: " + transaction.amount + ", Sender " + sender;
								}
								else if (transaction.amount < 0) {
									// Sent tip
									var recipient: string = JSON.parse(transaction.comment).recipient;
									message += "\n\tType: sent tip, Amount: " + transaction.amount + ", Recipient " + recipient;
								}
								break;
							case "send":
								if (transaction.address === donationAddress)
									message += "\n\tType: donation, Amount: " + transaction.amount + ", Address: " + transaction.address + ", Confirmations: " + transaction.confirmations;
								else
									message += "\n\tType: withdraw, Amount: " + transaction.amount + ", Address: " + transaction.address + ", Confirmations: " + transaction.confirmations;
								break;
							case "receive":
								message += "\n\tType: deposit, Amount: " + transaction.amount + ", Confirmations: " + transaction.confirmations;
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
								bot.sendMessage(chatterID, "The transaction fee of " + fee + " DOGE has been reimbursed");
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
					"	+donate <AMOUNT|all> doge - Donate doge to the developer to keep the bot alive. The server costs about 17,000 DOGE a month. Any help is greatly appreciated!",
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
		case "+donate":
			Collections.Users.findOne({"id": chatterID}, function(err: Error, user) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving user in +donate"));
					return;
				}
				if (!user) {
					bot.sendMessage(chatterID, "You must be registered to donate with your tipping account. You can also send some DOGE over to " + donationAddress);
					return;
				}
				dogecoin.getBalance(chatterID, function(err: any, balance: number) {
					if (err) {
						bot.sendMessage(chatterID, reportError(err, "Retrieving user balance in +donate"));
						return;
					}

					var rawDonationAmount: string = message.split(" ")[1];
					var donationAmount: number = 0;
					if (rawDonationAmount === undefined) {
						bot.sendMessage(chatterID, "Missing amount. Notation for +donate is '+donate <AMOUNT|all> doge'.");
						return;
					}
					if (rawDonationAmount.toLowerCase() === "all") {
						donationAmount = balance;
					}
					else {
						donationAmount = parseFloat(rawDonationAmount);
					}
					if (isNaN(donationAmount) || donationAmount < 1) {
						bot.sendMessage(chatterID, "Invalid amount of DOGE to donate");
						return;
					}
					dogecoin.sendFrom(chatterID, donationAddress, donationAmount, function(err: any, txid: string) {
						if (err) {
							if (err.code === -4) {
								// Wallet probably doesn't have enough funds
								reportError({message: "Insufficient server funds to complete donation request", id: chatterID, address: donationAddress, amount: donationAmount}, "Donating funds");
								bot.sendMessage(chatterID, "Sorry, the server doesn't have enough funds currently to complete that request. Most of the server's funds are kept offline in cold wallets to increase security. This bot's maintainer (RazeTheRoof) has been notified of the server's insufficient balance. He will fix this shortly. If this problem persists, please don't hesitate to email him at <petschekr@gmail.com>.");
							}
							else if (err.code === -6) {
								bot.sendMessage(chatterID, "You have insufficient funds to donate that much DOGE");
								bot.sendMessage(chatterID, "Your current balance is: " + balance + " DOGE");
							}
							else {
								bot.sendMessage(chatterID, reportError({code: err.code, id: chatterID, address: donationAddress, amount: donationAmount}, "Donating funds"));
							}
							return;
						}
						bot.sendMessage(chatterID, "Your donation of " + donationAmount + " DOGE was successfully donated. (Donation address: " + donationAddress + ")\nTxID for this donation is: " + txid + "\nThank you very much for your support of this project.");
						// Reimburse the user for their transaction fee
						dogecoin.getTransaction(txid, function(err: any, txInfo: any) {
							if (err) {
								bot.sendMessage(chatterID, reportError(err, "Retrieving tx info in +donate"));
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
								bot.sendMessage(chatterID, "The transaction fee of " + fee + " DOGE has been reimbursed");
							});
						});
					});
				});
			});
			break;
		case "+tip":
			Collections.Users.findOne({"id": chatterID}, function(err: Error, user) {
				if (err) {
					bot.sendMessage(chatterID, reportError(err, "Retrieving user in +tip"));
					return;
				}
				if (!user) {
					bot.sendMessage(chatterID, "You must be registered to tip someone");
					return;
				}
				dogecoin.getBalance(chatterID, function(err: any, balance: number) {
					if (err) {
						bot.sendMessage(chatterID, reportError(err, "Retrieving user balance in +tip"));
						return;
					}

					var tipInfo: any = message.split(" ");
					tipInfo.shift(); // Remove first element (the "+tip" command)
					tipInfo = tipInfo.join(" ");
					tipInfo = (/(.+?) ([\d\.]*) doge/i).exec(tipInfo) // Handle names with spaces
					if (tipInfo) {
						var personToTipName = tipInfo[1];
						var rawAmount: string = tipInfo[2];
					}
					else {
						bot.sendMessage(chatterID, "Invalid +tip format. Notation for +tip is '+tip <STEAM NAME|COMMUNITY URL> <AMOUNT|all> doge'.");
						return;
					}
					var amount: number = 0;
					if (rawAmount.toLowerCase() === "all") {
						amount = balance;
					}
					else {
						amount = parseFloat(rawAmount);
						if (isNaN(amount)) {
							bot.sendMessage(chatterID, "Invalid DOGE amount to tip entered");
							return;
						}
					}
					if (amount > balance) {
						bot.sendMessage(chatterID, "Insufficient funds to tip that much DOGE");
						bot.sendMessage(chatterID, "You can deposit more DOGE to your deposit address: " + user.address);
						return;
					}
					if (amount < 1) {
						bot.sendMessage(chatterID, "You must tip at least 1 DOGE");
						return;
					}
					if (personToTipName.toLowerCase() === "dogetippingbot") {
						bot.sendMessage(chatterID, "I'm sorry, but you can't tip me. If you would like to donate, please reply with '+donate <AMOUNT> doge'. Thank you!");
						return;
					}
					var personToTipID: string = undefined;
					if ((/^https?:\/\/steamcommunity\.com\/(?:id|profiles)\/.*$/i).exec(personToTipName)) {
						var communityURL: string = personToTipName;
						communityURL += "?xml=1"; // Get Steam to return an XML description
						http.get(communityURL, function(response) {
							response.setEncoding("utf8");
							var content: string = "";
							response.on("data", function (chunk): void {
								content += chunk;
							});
							response.on("end", function(): void {
								var $: any = cheerio.load(content, {xmlMode: true});
								personToTipID = $("steamID64").text();
								personToTipName = $("steamID").text();
								if (!personToTipName || !personToTipID) {
									bot.sendMessage(chatterID, "Oops, you probably entered the wrong Steam Community URL.");
									bot.sendMessage(chatterID, "These URLs have the format of <http://steamcommunity.com/id/razed> or <http://steamcommunity.com/profiles/76561198066172487>");
									bot.sendMessage(chatterID, "Make sure that you go to the person you want to tip's profile page and right click > Copy Page URL.");
									return;
								}
								continueWithTip();
							});
						}).on("error", function(err) {
							err.URL = communityURL;
							bot.sendMessage(chatterID, reportError(err, "Retrieving user information via their community URL"));
							return;''
						});
					}
					else {
						continueWithTip();
					}
					function continueWithTip(): void {
						Collections.Users.find({name: personToTipName}).toArray(function(err: Error, possibleUsers: any[]) {
							if (err) {
								bot.sendMessage(chatterID, reportError(err, "Retrieving users for +tip"));
								return;
							}
							if (personToTipID === undefined) {
								if (possibleUsers.length < 1) {
									bot.sendMessage(chatterID, "I can't find any users with that nickname!");
									bot.sendMessage(chatterID, "Find community URL to tip them. You can find this URL by visiting their profile page and right clicking > Copy Page URL.");
									bot.sendMessage(chatterID, "Then, tip with '+tip <COMMUNITY URL> <AMOUNT> doge'");
									bot.sendMessage(chatterID, "For example, '+tip http://steamcommunity.com/id/razed/ 100 doge +verify'");
									bot.sendMessage(chatterID, "They will receive a friend request and if they accept, they will be registered with the bot so you can tip them with their nickname.");
									bot.sendMessage(chatterID, "They will have 24 hours to accept before the tip is refunded.");
									return;
								}
								if (possibleUsers.length > 1) {
									bot.sendMessage(chatterID, "There are multiple users with that nickname!");
									return;
								}
								personToTipID = possibleUsers[0].id;
							}
							if (personToTipID === chatterID) {
								bot.sendMessage(chatterID, "wow. such self tip.");
							}
							var tipComment = {
								"sender": user.name,
								"recipient": personToTipName
							};
							dogecoin.move(chatterID, personToTipID, amount, 1, JSON.stringify(tipComment), function(err: any, success: boolean) {
								if (err) {
									bot.sendMessage(chatterID, reportError(err, "Moving funds while tipping"));
									return;
								}
								if (/\+verify/i.test(message))
									bot.sendMessage(DogeTipGroupID, personToTipName + " was tipped " + amount + " DOGE by " + user.name + "!");
								// Add the tip to the database
								Collections.Tips.insert({
									"sender": {
										"name": tipComment.sender,
										"id": chatterID
									},
									"recipient": {
										"name": tipComment.recipient,
										"id": personToTipID
									},
									"amount": amount,
									"timestamp": Date.now(),
									"time": new Date().toString(),
									"groupID": DogeTipGroupID
								}, {w:1}, function(err): void {
									if (err) {
										bot.sendMessage(chatterID, reportError(err, "Inserting tip into database"));
										return;
									}
									// Notify both parties of tip
									bot.sendMessage(chatterID, "You tipped " + personToTipName + " " + amount + " DOGE successfully");
									bot.sendMessage(personToTipID, "You were tipped " + amount + " DOGE by " + user.name);
								});
							});
						});
					}
				});
			});
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