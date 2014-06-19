/// <reference path="typescript_defs/node.d.ts" />

var fs = require("fs");
var BigIntLib = require("./biginteger");
var dgram = require("dgram");
var server = dgram.createSocket("udp4");
var moment = require("moment");

// Line by line parsing transform stream
var stream = require("stream");
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
liner.on("readable", function(): void {
	var line: string;
	while (line = liner.read()) {
		// Parse the line
	}
});

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

class TF2Parser {
	private playerJoinCallback(steamID: string, name: string, team: string) => void;
	private roundWinnerCallback(team: string) => void;

	public scores: {red: number; blue: number} = {"red": 0, "blue": 0};
	public wagersCanBePlaced: boolean = false;

	constructor(playerJoinCallback(steamID: string, name: string, team: string) => void, roundWinnerCallback(team: string) => void) {
		this.playerJoinCallback = playerJoinCallback;
		this.roundWinnerCallback = roundWinnerCallback;
	}
	parseLine(line: string): void {
		var timeRegEx: RegExp = /L (\d\d\/\d\d\/\d\d\d\d - \d\d:\d\d:\d\d):/;
		var joinServerRegEx: RegExp = /"(.+?)<\d+><(STEAM_\d:\d:\d+)><.*?" joined team "(Red|Blue)"/;
		var roundWinRegEx: RegExp = /World triggered "Round_Win" \(winner "(Red|Blue)"\)/;
		var roundStarted: RegExp = /World triggered "Round_Start"/;
		var setupEnded: RegExp = /World triggered "Round_Setup_End"/;

		var time: Date = moment(timeRegEx.exec(line)[1], "MM/DD/YYYY - HH:mm:ss").toDate();

		var joinServerParsed: any[] = joinServerRegEx.exec(line);
		if (joinServerParsed) {
			// Player joined server
			playerJoinCallback(this.getSteamID(joinServerParsed[2]), joinServerParsed[1], joinServerParsed[3]);
		}
		var roundWinParsed: any[] = roundWinRegEx.exec(line);
		if (roundWinParsed) {
			var winningTeam = roundWinParsed[1]; // "Red" or "Blue"
			this.roundWinnerCallback(winningTeam);
		}
		if (roundStarted.exec(line)) {
			this.wagersCanBePlaced = true;
		}
		if (setupEnded.exec(line)) {
			this.wagersCanBePlaced = false;
		}
	}
	static getSteamID(TF2ID: string) {
		var ID_ADDEND = new BigIntLib.BigInteger("76561197960265728");
		var matches = TF2ID.match(/^STEAM_(\d):(\d):(\d+)$/);
		if (matches && matches.length > 0) {
			var server = new BigIntLib.BigInteger(matches[2]), authId = new BigIntLib.BigInteger(matches[3]);
			return authId.multiply(new BigIntLib.BigInteger('2')).add(ID_ADDEND).add(server).toString();
		}
		return null;
	}
}