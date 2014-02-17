fs = require "fs"
Steam = require "steam"

DogeTipDiscussions = "http://steamcommunity.com/groups/DogeTip/discussions"
DogeTipGroupID = "103582791435182182"

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
	console.log "Received chat message: " + message
	if message == "Friend"
		bot.addFriend chatterID
	#bot.sendMessage sourceID, "Your steamID is: " + chatterID #, Steam.EChatEntryType.ChatMsg); // ChatMsg by default
bot.on "friend", (steamID, Relationship) ->
	console.log "steamID: #{steamID}"
	console.log "Relationship: #{Relationship}"