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
	bot.users[steamID]?.playerName
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
			amount = parseFloat amount, 10
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
							transaction.status = "cancelled"
							user.history[transactionIndex] = transaction
					await Users_collection.update {id: chatterID}, {$set:{history: user.history}}, {w:1}, defer(err)
					if err
						console.error err
						return bot.sendMessage chatterID, "The database ran into an error"
					# Notify the user
					bot.sendMessage chatterID, "Balance was not paid within 30 minutes so the transaction was cancelled"
				else
					bot.sendMessage chatterID, "Your payment is currently '#{body.status}'"
		when "+balance"
			await checkIfRegistered chatterID, defer(registered, user)
			if registered is undefined
				return bot.sendMessage chatterID, "The database ran into an error"
			unless registered
				return bot.sendMessage chatterID, "You must register before you can add funds. Do this by sending '+register'."

			balance = user.funds
			bot.sendMessage chatterID, "You currently have #{balance} DOGE to tip with"
		when "+history"
			await checkIfRegistered chatterID, defer(registered, user)
			if registered is undefined
				return bot.sendMessage chatterID, "The database ran into an error"
			unless registered
				return bot.sendMessage chatterID, "You must register before you can add funds. Do this by sending '+register'."			
			history = user.history
			history = history.splice history.length - 10, history.length # Last 10 transactions in the history
			message = "#{user.name}, here are your last 10 transactions:\n"
			message += "Current balance: #{user.funds}\n"
			for item in history by -1 # Go backwards
				switch item.type
					when "add"
						message += "\n\tType: add, Amount: #{item.amount}, Status: #{item.status}"
			bot.sendMessage chatterID, message
		when "+withdraw"
			await checkIfRegistered chatterID, defer(registered, user)
			if registered is undefined
				return bot.sendMessage chatterID, "The database ran into an error"
			unless registered
				return bot.sendMessage chatterID, "You must register before you can add funds. Do this by sending '+register'."

			address = message.split(" ")[1]
			unless address?
				return bot.sendMessage chatterID, "Missing address. Notation for +withdraw is '+withdraw <ADDRESS> <AMOUNT|all> doge'."
			amount = message.split(" ")[2]
			unless amount?
				return bot.sendMessage chatterID, "Missing amount. Notation for +withdraw is '+withdraw <ADDRESS> <AMOUNT|all> doge'."

			if amount.toLowerCase() is "all"
				amount = user.funds
			else
				amount = parseFloat amount, 10
				if isNaN(amount)
					return bot.sendMessage chatterID, "Invalid DOGE to withdraw"
				if amount > user.funds - 1
					return bot.sendMessage chatterID, "You can't withdraw that many DOGE (remember that there is a 1 DOGE transaction fee from the network)"
			amount -= 1 # 1 DOGE network transaction fee

			payload = {amount, destination: address}
			options =
				"method": "POST"
				"url": "https://moolah.ch/api/merchant/send"
				"form":
					"guid": moolah.guid
					"api_key": moolah.api_key
					"payload": payload
			requester options, (error, response, body) ->
				unless !error and response.statusCode is 200
					console.error "#{Date.now().toString()} - #{error}, #{response}, #{body}"
					return bot.sendMessage chatterID, "Moolah ran into an error processing your request"
				try
					body = JSON.parse body
				catch e
					return bot.sendMessage chatterID, "Moolah returned invalid JSON"
				if body.status is "failure"
					# Something prevented Moolah from sending the money
					console.error "#{Date.now().toString()} - Withdrawl error: #{body.reason}"
					return bot.sendMessage chatterID, "Moolah couldn't withdraw your funds. Stated reason: '#{body.reason}'."
				withdrawTx =
					"type": "withdraw"
					"amount": -amount
					"status": "sent"
				await Users_collection.update {id: chatterID}, {$inc: {funds: -(amount + 1), $push:{history: withdrawTx}}, {w:1}, defer(err)
				if err
					console.error err
					return bot.sendMessage chatterID, "The database ran into an error"
				bot.sendMessage chatterID, "#{body.amount} DOGE sent to #{body.destination} successfully"
		when "+tip"
			# Tip a Steam-using shibe
			await checkIfRegistered chatterID, defer(registered, user)
			if registered is undefined
				return bot.sendMessage chatterID, "The database ran into an error"
			unless registered
				return bot.sendMessage chatterID, "You must register before you can add funds. Do this by sending '+register'."

			tipInfo = message.split(" ")
			tipInfo.shift() # Remove first element (the "+tip" command)
			tipInfo = tipInfo.join(" ")
			tipInfo = (/([\w\s]+?) ([\d\.]*) doge/i).exec tipInfo # Handle names with spaces
			if tipInfo?
				shibe = tipInfo[1]
				amount = tipInfo[2]
			else
				return bot.sendMessage chatterID, "Invalid +tip input. Notation for +tip is '+tip <STEAM NAME> <AMOUNT|all> doge'."

			if amount.toLowerCase() is "all"
				amount = user.funds
			else
				amount = parseFloat amount, 10
				if isNaN(amount)
					return bot.sendMessage chatterID, "Invalid DOGE amount to tip entered"
				if amount > user.funds
					return bot.sendMessage chatterID, "Insufficient funds to tip that much DOGE"
				if amount <= 0
					return bot.sendMessage chatterID, "You must tip more than 0 DOGE"
			# Retrieve the user's steamid
			shibeID = undefined
			# First check if the bot has them registered already
			await Users_collection.findOne {"name": shibe}, defer(err, registeredShibe)
			if err
				console.error err
				return bot.sendMessage chatterID, "The database ran into an error"
			if registeredShibe
				shibeID = registeredShibe.id
			else
				return bot.sendMessage chatterID, "'#{shibe}' hasn't registered yet with the bot. Have them join the group and +register."
			# Move the funds
			# Decrement funds (for tipper)
			tip1Tx =
				"type": "sent tip"
				"amount": -amount
				"status": "sent"
			await Users_collection.update {id: chatterID}, {$inc: {funds: -amount}, $push:{history: tip1Tx}}, {w:1}, defer(err)
			if err
				console.error err
				return bot.sendMessage chatterID, "The database ran into an error"
			# Increment funds (for tippee)
			tip2Tx =
				"type": "received tip"
				"amount": amount
				"status": "received"
			await Users_collection.update {id: shibeID}, {$inc: {funds: amount}, $push:{history: tip2Tx}}, {w:1}, defer(err)
			if err
				console.error err
				return bot.sendMessage chatterID, "The database ran into an error"


bot.on "friend", (steamID, Relationship) ->
	if pendingInvites.indexOf(steamID) isnt -1
		# Have they accepted?
		if Relationship is Steam.EFriendRelationship.Friend
			pendingInvites.splice pendingInvites.indexOf(steamID), 1

			bot.joinChat steamID
			bot.sendMessage steamID, "Hi, I'm DogeTippingBot"