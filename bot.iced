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
await db.collection "users", defer(err, Users_collection)
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
	name = bot.users[steamID]?.playerName
checkIfRegistered = (steamID, cb) ->
	await Users_collection.findOne {id: steamID}, defer(err, user)
	if err
		console.error err
		cb undefined, undefined
	registered = if user then true else false
	cb registered, user

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

			await checkIfRegistered chatterID, defer(registered)
			if registered is undefined
				return bot.sendMessage chatterID, "The database ran into an error"
			if registered
				return bot.sendMessage chatterID, "You've already registered"
			else
				userEntry =
					id: chatterID
					name: name
					funds: 0
					history: []
				await Users_collection.insert userEntry, {w:1}, defer(err)
				if err
					console.error "DBError: #{err}"
					return bot.sendMessage chatterID, "DBError: #{err}"
				bot.sendMessage chatterID, "Welcome #{name}"
				bot.sendMessage chatterID, "Reply '+add <AMOUNT> doge' to add dogecoins to your account"
				bot.sendMessage chatterID, "Tip users with '+tip <STEAM NAME> <AMOUNT> doge'"
		when "+add"
			await checkIfRegistered chatterID, defer(registered, user)
			if registered is undefined
				return bot.sendMessage chatterID, "The database ran into an error"
			unless registered
				return bot.sendMessage chatterID, "You must register before you can add funds. Do this by sending '+register'."

			if user
				for transaction in user.history
					if transaction.status is "pending" then return bot.sendMessage chatterID, "You already have an +add request pending"

			amount = message.split(" ")[1]
			amount = parseInt amount, 10
			if isNaN(amount)
				return bot.sendMessage chatterID, "Invalid number of doge specified"
			options =
				"url": "https://moolah.ch/api/pay"
				"method": "GET"
				"qs":
					"guid": moolah.guid
					"currency": "DOGE"
					"amount": amount
					"product": "Add Funds"
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
				# TEMPORARY; USE AN IPN CALLBACK
				bot.sendMessage chatterID, "Send '+finishadd' to finish the adding process"
				
				fundTx =
					"type": "add"
					"amount": body.amount
					"status": "pending"
					"tx": body.tx
				await Users_collection.update {id: chatterID}, {$push:{history: fundTx}}, {w:1}, defer(err)
				if err
					console.error err
					bot.sendMessage chatterID, "The database ran into an error" 
		when "+finishadd"
			await checkIfRegistered chatterID, defer(registered, user)
			if registered is undefined
				return bot.sendMessage chatterID, "The database ran into an error"
			unless registered
				return bot.sendMessage chatterID, "You must register before you can add funds. Do this by sending '+register'."

			for transaction in user.history
				if transaction.status is "pending"
					break
			unless transaction?
				return bot.sendMessage chatterID, "You have no +add requests pending"

			requester "https://moolah.ch/api/pay/check/#{transaction.tx}", (error, response, body) ->
				unless !error and response.statusCode is 200
					console.error "#{Date.now().toString()} - #{error}, #{response}, #{body}"
					return bot.sendMessage chatterID, "Moolah ran into an error processing your request"
				try
					body = JSON.parse body
				catch e
					return bot.sendMessage chatterID, "Moolah returned invalid JSON"
				if body.status is "complete"
					# Payment was successful
					# Update the funds in the DB
					for transaction, transactionIndex in user.history
						if transaction.status is "pending"
							transaction.status = "complete"
							user.history[transactionIndex] = transaction
					await Users_collection.update {id: chatterID}, {$set: {history: user.history}, $inc: {funds: transaction.amount}}, {w:1}, defer(err)
					if err
						console.error err
						return bot.sendMessage chatterID, "The database ran into an error"

					bot.sendMessage chatterID, "Payment processed successfully; You can now tip with it"
				else if body.status is "cancelled"
					# User didn't send the funds within 30 minutes
					# Cancel the request in the DB
					for transaction, transactionIndex in user.history
						if transaction.status is "pending"
							user.history.splice transactionIndex, 1
					await Users_collection.update {id: chatterID}, {$set:{history: user.history}}, {w:1}, defer(err)
					if err
						console.error err
						return bot.sendMessage chatterID, "The database ran into an error"
					# Notify the user
					bot.sendMessage chatterID, "Balance was not paid within 30 minutes so the transaction was cancelled"
				else
					bot.sendMessage chatterID, "Your payment is currently '#{body.status}'"

bot.on "friend", (steamID, Relationship) ->
	if pendingInvites.indexOf(steamID) isnt -1
		# Have they accepted?
		if Relationship is Steam.EFriendRelationship.Friend
			pendingInvites.splice pendingInvites.indexOf(steamID), 1

			bot.joinChat steamID
			bot.sendMessage steamID, "Hi, I'm DogeTippingBot"