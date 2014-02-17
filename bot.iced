fs = require "fs"
requester = require "request"
MongoClient = require("mongodb").MongoClient
Steam = require "steam"

DogeTipDiscussions = "http://steamcommunity.com/groups/DogeTip/discussions"
DogeTipGroupID = "103582791435182182"
pendingInvites = []

# Connect to the database
await MongoClient.connect "mongodb://192.168.1.115:27017/dogebot", defer(err, db)
if err
	console.error err
	process.exit 1
await db.collection "users", defer(err, collection)
if err
	console.error err
	process.exit 1

# Connect to Steam
bot = new Steam.SteamClient()
{credentials} = require "./auth.coffee"
bot.logOn credentials
bot.on "loggedOn", ->
	console.log "Logged in as '#{credentials.accountName}'"
	bot.setPersonaState Steam.EPersonaState.Online # to display your bot's status as "Online"
	console.log "SteamID: " + bot.steamID
	
	bot.joinChat DogeTipGroupID
	bot.sendMessage DogeTipGroupID, "dogetippingbot is back online"

bot.on "chatMsg", (sourceID, message, type, chatterID) ->
	if message == "Friends"
		bot.sendMessage DogeTipGroupID, JSON.stringify(bot.friends)
bot.on "friendMsg", (chatterID, message, type) ->
	# Private messages
	return if message is ""

bot.on "friend", (steamID, Relationship) ->
	if pendingInvites.indexOf(steamID) isnt -1
		# Have they accepted?
		if Relationship is Steam.EFriendRelationship.Friend
			pendingInvites.splice pendingInvites.indexOf(steamID), 1

			bot.joinChat steamID
			bot.sendMessage steamID, "Hi, I'm DogeTippingBot"