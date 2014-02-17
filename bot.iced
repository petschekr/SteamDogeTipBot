fs = require "fs"
requester = require "request"
MongoClient = require("mongodb").MongoClient
Steam = require "steam"

DogeTipDiscussions = "http://steamcommunity.com/groups/DogeTip/discussions"
DogeTipGroupID = "103582791435182182"

pendingInvites = []
pendingPayments = []

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
secrets = require "./auth.coffee"
{credentials} = secrets
{moolah} = secrets

bot.logOn credentials
bot.on "loggedOn", ->
	console.log "Logged in as '#{credentials.accountName}'"
	bot.setPersonaState Steam.EPersonaState.Online # to display your bot's status as "Online"
	console.log "SteamID: " + bot.steamID
	
	bot.joinChat DogeTipGroupID
	bot.sendMessage DogeTipGroupID, "dogetippingbot is back online"
# Functions
getNameFromID = (steamID) ->
	bot.users[steamID].playerName

bot.on "chatMsg", (sourceID, message, type, chatterID) ->
	if message is "Me"
		bot.sendMessage DogeTipGroupID, bot.users[chatterID].playerName
		bot.sendMessage DogeTipGroupID, chatterID
bot.on "friendMsg", (chatterID, message, type) ->
	# Private messages
	return if message is ""
	switch message.split(" ")[0] # The command part
		when "+register"
			name = getNameFromID chatterID
			bot.sendMessage chatterID, "Welcome #{name}"
			bot.sendMessage chatterID, "Reply '+add <AMOUNT> doge' to add dogecoins to your account"
			bot.sendMessage chatterID, "Tip users with '+tip <STEAM NAME> <AMOUNT> doge'"
		when "+add"
			amount = message.split(" ")[1]
			amount = parseInt amount, 10
			if isNaN(amount)
				return bot.sendMessage chatterID, "Invalid number of doge specified"
			bot.sendMessage chatterID, "You'll be adding #{amount} doge"
			options =
				"url": "https://moolah.ch/api/pay"
				"method": "GET"
				"qs":
					"guid": moolah.guid
					"currency": "DOGE"
					"amount": amount
					"product": "Add Tipping Money"
					"return": ""
			requester options, (error, response, body) ->
				unless !error and response.statusCode is 200
					console.error "#{Date.now().toString()} - #{error}, #{response}, #{body}"
					return bot.sendMessage chatterID, "Moolah ran into an error processing your request"
				try
					body = JSON.parse body
				catch e
					return bot.sendMessage chatterID, "Moolah returned invalid JSON"
				bot.sendMessage chatterID, "Visit #{body.url} or send #{body.amount} #{body.currency} to #{body.address}"
				pendingPayments.push {
					"steamID": chatterID
					"amount": amount
					"tx": body.tx
				}

bot.on "friend", (steamID, Relationship) ->
	if pendingInvites.indexOf(steamID) isnt -1
		# Have they accepted?
		if Relationship is Steam.EFriendRelationship.Friend
			pendingInvites.splice pendingInvites.indexOf(steamID), 1

			bot.joinChat steamID
			bot.sendMessage steamID, "Hi, I'm DogeTippingBot"