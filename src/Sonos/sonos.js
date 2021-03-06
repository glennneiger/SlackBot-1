const autoBind = require('auto-bind');
const _ = require('lodash');
const { Sonos: SonosClient, SpotifyRegion } = require('sonos');

const { secondFormatter, padRight } = require('./../utils');
const spotify = require('./spotify');

const {
    channels,
    volumeInterval,
    volumeMax,
    playlistNameMax,
    sonosIp,
    spotifyMarket,
} = require('./config');

let SlackRTM;
let SlackWeb;
let Sonos;
let Spotify;

const playmodes = ['NORMAL', 'REPEAT_ONE', 'REPEAT_ALL', 'SHUFFLE', 'SHUFFLE_NOREPEAT', 'SHUFFLE_REPEAT_ONE'];

class SonosClass {
    constructor(slackRTMClient, slackWebClient) {
        SlackRTM = slackRTMClient;
        SlackWeb = slackWebClient;

        // CONNECT SONOS
        Sonos = new SonosClient(sonosIp);

        if (spotifyMarket !== 'US') {
            Sonos.setSpotifyRegion(SpotifyRegion.EU);
        }

        // INITIALIZE SPOTIFY
        Spotify = new spotify();

        // MESSAGE LISTENER
        SlackRTM.on('message', (event) => this.processInput(event));

        autoBind(this);
    }

    // PROCESS POST REQUESTS
    async processPostRequest(payload, channel, user, timestamp) {
        const type = payload.shift();

        if (type === 'song') {
            this._addUri(payload.shift(), channel, user, timestamp);
        }
    }

    // PROCESS SLACK COMMANDS
    async processInput(event) {
        const message = event.text;
        const channel = event.channel;
        const channelName = await this._getChannelName(channel);

        if (channels.includes(channelName)) {
            if (message && message.charAt(0) === '!') {
                const splitMessage = message.substring(1).split(' ');
                const command = splitMessage.shift().toLowerCase();
                const input = splitMessage.join(' ');

                switch (command) {
                    case 'play':
                        this._play(channel);
                        break;

                    case 'resume':
                        this._resume(channel);
                        break;

                    case 'stop':
                        this._stop(channel);
                        break;

                    case 'pause':
                        this._pause(channel);
                        break;

                    case 'next':
                        this._next(channel);
                        break;

                    case 'previous':
                    case 'prev':
                    case 'back':
                        this._prev(channel);
                        break;

                    case 'current':
                        this._current(channel);
                        break;

                    case 'playlist':
                    case 'list':
                    case 'songs':
                        this._playlist(channel);
                        break;

                    case 'createplaylist':
                        this._createPlaylist(input, channel);
                        break;

                    case 'playlists':
                        this._playlists(channel);
                        break;

                    case 'setplaylist':
                        this._setPlaylist(input, channel);
                        break;

                    case 'playmode':
                        this._playmode(input, channel);
                        break;

                    case 'search':
                        this._searchSong(input, channel);
                        break;

                    case 'searchalbum':
                        this._searchAlbum(input, channel);
                        break;

                    case 'searchplaylist':
                        this._searchPlaylist(input, channel);
                        break;

                    case 'add':
                        this._addSearch(input, channel);
                        break;

                    case 'remove':
                    case 'rem':
                    case 'del':
                        this._remove(input, channel);
                        break;

                    case 'volume':
                    case 'vol':
                        this._volume(input, channel);
                        break;

                    case 'help':
                        this._help(channel);
                        break;

                    default:
                        this._slackMessage(`I'm sorry, but ${command} is not a command`, channel);
                        break;
                }
            }
        }
    }

    // HELPER FUNCTIONS
    async _getChannelName(channel) {
        try {
            const channelInfo = await SlackWeb.conversations.info({ channel });

            if (channelInfo.ok && channelInfo.channel) {
                return channelInfo.channel.name;
            }
        } catch (err) {
            console.error('An error occurred getting channel info:', error);
        }
    }

    async _slackMessage(message, channel) {
        try {
            await SlackRTM.sendMessage(message, channel);
        } catch (error) {
            console.error('An error occurred sending a message:', error);
        }
    }

    async _slackRichMessage(blocks, channel) {
        try {
            await SlackWeb.chat.postMessage({ blocks, channel });
        } catch (error) {
            console.error('An error occurred sending a rich message:', error);
        }
    }

    async _slackUpdateMessage(blocks, channel, timestamp) {
        try {
            await SlackWeb.chat.update({ blocks, channel, ts: timestamp });
        } catch (error) {
            console.error('An error occurred updating an message:', error);
        }
    }

    _slackMessageWithImage(message, image) {
        try {
            const blocks = [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": message,
                    },
                    "accessory": {
                        "type": "image",
                        "image_url": image,
                        "alt_text": "Album Art",
                    },
                },
            ];

            return blocks;
        } catch (error) {
            console.error('An error occurred constructing an image message:', error);
        }
    }

    _slackMessageWithButtons(options) {
        try {
            const blocks = _.flatMap(options, (option) => ([
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": option.message,
                    },
                    "accessory": {
                        "type": "button",
                        "text": {
                            "type": "plain_text",
                            "text": "Add to Playlist",
                            "emoji": true,
                        },
                        "value": `sonos|${option.action}`,
                    },
                },
                {
                    "type": "divider"
                }
            ]));

            blocks.pop();

            return blocks;
        } catch (error) {
            console.error('An error occurred constructing a button message:', error);
        }
    }

    async _sonosStatus() {
        try {
            return await Sonos.getCurrentState();
        } catch (error) {
            console.error('An error occurred getting the sonos status!:', error);
        }
    }

    async _currentSong() {
        try {
            const { artist, title, duration, position, queuePosition } = await Sonos.currentTrack();

            const durationFormatted = secondFormatter(duration);
            const positionFormatted = secondFormatter(position);

            return { artist, title, position: positionFormatted, duration: durationFormatted, playlistPosition: queuePosition };
        } catch (error) {
            console.error('An error occurred getting the current song info:', error);
        }
    }

    // COMMAND FUNCTIONS
    async _help(channel) {
        try {
            const message = [
                'Current commands!',
                ' ===  ===  ===  ===  ===  ===  ===  ===  ===  ===  === ',
                '`!play` : Play/Resume song',
                '`!stop` : Stop song',
                '`!pause` : Pause song',
                '`!next` : Play the next song',
                '`!previous` : Play the previous song',
                '`!current` : Display the current song',
                '`!playlist` : Display the entire playlist',
                '`!playlists` : Display a list of all saved playlists',
                '`!playmode` : Display the current playmode',
                '`!playmode <playmode>` : Change the playmode',
                '`!search <text>` : Search Spotify for a song',
                '`!searchalbum <text>` : Search Spotify for a album',
                '`!searchplaylist <text>` : Search Spotify for a playlist',
                '`!add <text>` : Add the first returned song result from Spotify to the playlist',
                '`!remove <playlist position>` : Remove a song at the position from the playlist',
                '`!volume` : Display current volume level',
                '`!volume <up/down/number>` : Change volume level up/down',
                ' ===  ===  ===  ===  MatthewBridgeman  ===  ===  ===  === ',
            ].join('\n');

            this._slackMessage(message, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to display the help list! :(`, channel);
            console.error('An error occurred displaying the help list:', error);
        }
    }

    async _current(channel) {
        try {
            const { artist, title, position, duration } = await this._currentSong();
            const status = await this._sonosStatus();

            if (!artist || !title) {
                return this._slackMessage('There is no currently selected song!', channel);;
            }

            const message = [
                `:notes: Current song: *${artist}* - *${title}* (${position} / ${duration}) :notes:`,
                `Current status: *${_.startCase(status)}*`,
            ].join('\n');

            this._slackMessage(message, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to get the current song! :(`, channel);
            console.error('An error occurred getting the current song:', error);
        }
    }

    async _play(channel) {
        try {
            const status = await this._sonosStatus();

            if (status === 'playing') {
                return this._slackMessage('A song is already playing!', channel);;
            }

            const success = await Sonos.play();

            if (!success) {
                return this._slackMessage('Sorry! Unable to play the song! :(', channel);;
            }

            const { artist, title, duration } = await this._currentSong();

            if (!artist || !title) {
                return this._slackMessage('There is no currently selected song to play!', channel);;
            }

            const state = status === 'stopped' ? 'Started' : 'Resumed';

            this._slackMessage(`${state} playing: *${artist}* - *${title}* (${duration})`, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to play the song! :(`, channel);
            console.error('An error occurred playing the song:', error);
        }
    }

    async _stop(channel) {
        try {
            const status = await this._sonosStatus();

            if (status !== 'playing') {
                return this._slackMessage('A song must be playing to stop!', channel);;
            }

            const success = await Sonos.stop();

            if (!success) {
                return this._slackMessage('Sorry! Unable to stop the song! :(', channel);;
            }

            const { artist, title } = await this._currentSong();

            if (!artist || !title) {
                return this._slackMessage('There is no currently selected song to stop playing!', channel);;
            }

            this._slackMessage(`Stopped playing: *${artist}* - *${title}*`, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to stop the song! :(`, channel);
            console.error('An error occurred stopping the song:', error);
        }
    }

    async _pause(channel) {
        try {
            const status = await this._sonosStatus();

            if (status !== 'playing') {
                return this._slackMessage('A song must be playing to pause!', channel);;
            }

            const success = await Sonos.pause();

            if (!success) {
                return this._slackMessage('Sorry! Unable to pause the song! :(', channel);;
            }

            const { artist, title, position, duration } = await this._currentSong();

            if (!artist || !title) {
                return this._slackMessage('There is no currently selected song to pause playing!', channel);;
            }

            this._slackMessage(`Paused playing: *${artist}* - *${title}* (${position} / ${duration})`, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to pause the song! :(`, channel);
            console.error('An error occurred pausing the song:', error);
        }
    }

    async _next(channel) {
        try {
            const success = await Sonos.next();

            if (!success) {
                return this._slackMessage('Sorry! Unable to play the next song! :(', channel);;
            }

            const { artist, title, duration } = await this._currentSong();

            if (!artist || !title) {
                return this._slackMessage('There is no song to play next!', channel);;
            }

            this._slackMessage(`Now playing next song in playlist: *${artist}* - *${title}* (${duration})`, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to play the next song! :(`, channel);
            console.error('An error occurred playing the next song in playlist:', error);
        }
    }

    async _prev(channel) {
        try {
            const success = await Sonos.previous();

            if (!success) {
                return this._slackMessage('Sorry! Unable to play the previous song! :(', channel);;
            }

            const { artist, title, duration } = await this._currentSong();

            if (!artist || !title) {
                return this._slackMessage('There is no previous song to play!', channel);;
            }

            this._slackMessage(`Now playing previous song in playlist: *${artist}* - *${title}* (${duration})`, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to play the previous song! :(`, channel);
            console.error('An error occurred playing the previous song in playlist:', error);
        }
    }

    async _searchSong(input, channel) {
        try {
            if (!input) {
                return this._slackMessage('You must specify a song to search for!\n!search <song name>', channel);
            }

            const songList = await Spotify.searchSong(input);

            if (!songList.length) {
                return this._slackMessage('No songs found! :(', channel);
            }

            const songs = songList.map(songInfo => {
                const { artist, song, album, releaseDate, uri } = songInfo;

                const message = [
                    `:musical_note: *${artist}* - *${song}*`,
                    `:notebook: ${album}`,
                    `:clock3: ${releaseDate}`,
                ].join('\n');

                return {
                    message,
                    action: `song|${uri}`,
                }
            });

            const blocks = this._slackMessageWithButtons(songs);
            await this._slackRichMessage(blocks, channel);
        } catch (error) {
            this._slackMessage(`An error occurred searching for the song! :(`, channel);
            console.error('An error occurred searching for a song:', error);
        }
    }

    async _searchAlbum(input, channel) {
        try {
            if (!input) {
                return this._slackMessage('You must specify an album to search for!\n!searchalbum <album name>', channel);
            }

            const albumList = await Spotify.searchAlbum(input);

            if (!albumList.length) {
                return this._slackMessage('No albums found! :(', channel);
            }

            const albums = albumList.map(albumInfo => {
                const {
                    artist,
                    album,
                    releaseDate,
                    totalTracks,
                } = albumInfo;

                return `${padRight(`${artist} - ${album} (${totalTracks} songs)`, 80)} Released: ${releaseDate}`;
            });

            const message = `\`\`\`${albums.join('\n')}\`\`\``;

            this._slackMessage(message, channel);
        } catch (error) {
            this._slackMessage(`An error occurred searching for the album! :(`, channel);
            console.error('An error occurred searching for an album:', error);
        }
    }

    async _searchPlaylist(input, channel) {
        try {
            if (!input) {
                return this._slackMessage('You must specify a playlist to search for!\n!searchplaylist <playlist name>', channel);
            }

            const playlistList = await Spotify.searchPlaylist(input);

            if (!playlistList.length) {
                return this._slackMessage('No playlists found! :(', channel);
            }

            const playlists = playlistList.map(playlistInfo => {
                const {
                    playlist,
                    totalTracks,
                } = playlistInfo;

                return `${playlist} (${totalTracks} songs)`;
            });

            const message = `\`\`\`${playlists.join('\n')}\`\`\``;

            this._slackMessage(message, channel);
        } catch (error) {
            this._slackMessage(`An error occurred searching for the playlist! :(`, channel);
            console.error('An error occurred searching for a playlist:', error);
        }
    }

    async _addSearch(input, channel) {
        try {
            if (!input) {
                return this._slackMessage('You must specify a song to search for!\n!add <song name>', channel);
            }

            const songList = await Spotify.searchSong(input);

            if (!songList.length) {
                return this._slackMessage('No songs found! :(', channel);
            }

            const {
                artist,
                song,
                album,
                albumImage,
                uri,
            } = songList[0];

            const result = await Sonos.queue(uri);
            const {
                FirstTrackNumberEnqueued: position,
                NewQueueLength: playlistLength,
            } = result;

            const message = [
                `Sure thing! *${artist}* - *${song} (${album})* has been added to the queue!`,
                '',
                `Position *${position}* out of *${playlistLength}* in playlist`,
            ].join('\n');

            const blocks = this._slackMessageWithImage(message, albumImage);
            await this._slackRichMessage(blocks, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to add the song to the playlist! :(`, channel);
            console.error('An error occurred adding a song to the playlist:', error);
        }
    }

    async _addUri(uri, channel, user, timestamp) {
        try {
            if (!uri) {
                this._slackMessage(`An error occurred trying to add the song to the playlist! :(`, channel);
                console.error('An error occurred adding a song to the playlist: No URI returned from search.');
            }

            const [uriService, uriType, uriSong] = uri.split(':');

            if (uriService !== 'spotify' || uriType !== 'track') {
                this._slackMessage(`An error occurred trying to add the song to the playlist! :(`, channel);
                console.error('An error occurred adding a song to the playlist: Invalid URI:', uri);
            }

            const result = await Sonos.queue(uri);
            const {
                FirstTrackNumberEnqueued: position,
                NewQueueLength: playlistLength,
            } = result;

            const songInfo = await Spotify.getSong(uriSong);

            const {
                artist,
                song,
                album,
                albumImage,
            } = songInfo;

            const message = [
                `Sure thing, <@${user}>! *${artist}* - *${song} (${album})* has been added to the queue!`,
                '',
                `Position *${position}* out of *${playlistLength}* in playlist`,
            ].join('\n');

            const blocks = this._slackMessageWithImage(message, albumImage);
            await this._slackUpdateMessage(blocks, channel, timestamp);
        } catch (error) {
            this._slackMessage(`An error occurred trying to add the song to the playlist! :(`, channel);
            console.error('An error occurred adding a song to the playlist:', error);
        }
    }

    async _remove(input, channel) {
        try {
            if (!input || input.split(' ')[0] === '') {
                return this._slackMessage('You must specify a playlist position to remove!\n!remove <position>', channel);
            }

            const trackNumber = input.split(' ')[0];

            if ((!Number(trackNumber) && Number(trackNumber) !== 0) || isNaN(trackNumber)) {
                return this._slackMessage(`*${trackNumber}* is not a number!`, channel);
            }

            const { items: playlist } = await Sonos.getQueue();
            const song = playlist[trackNumber - 1];

            if (!song) {
                return this._slackMessage(`There is no song at position *${trackNumber}*`, channel);
            }

            const { title, artist, album } = song;

            await Sonos.removeTracksFromQueue(trackNumber);

            this._slackMessage(`*${artist}* - *${title} (${album})* has been removed from the playlist`, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to remove the song from the playlist! :(`, channel);
            console.error('An error occurred removing a song from the playlist:', error);
        }
    }

    async _playlist(channel) {
        try {
            const playlist = await Sonos.getQueue();

            const songs = playlist.items.map((song, index) => {
                const { title, artist, album } = song;
                index = index + 1;

                return `${index}. ${artist} - ${title} (${album})`;
            });

            const { artist, title, duration, position, playlistPosition } = await this._currentSong();

            const message = [
                `:notes: Currently playing #${playlistPosition}: *${artist}* - *${title}* (${position} / ${duration}) :notes:`,
                `\`\`\`${songs.join('\n')}\`\`\``,
            ].join('\n');

            this._slackMessage(message, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to get the playlist! :(`, channel);
            console.error('An error occurred getting the playlist:', error);
        }
    }

    async _createPlaylist(input, channel) {
        try {
            if (!input) {
                return this._slackMessage('You must specify a playlist name!\n!createplaylist <playlist name>', channel);
            }

            if (input.length > playlistNameMax) {
                return this._slackMessage(`Playlist names are limited to *${playlistNameMax}* characters!`, channel);
            }

            await Sonos.createPlaylist(input);

            this._slackMessage(`Playlist *${input}* successfully created!`, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to create the playlist! :(`, channel);
            console.error('An error occurred creating the playlist:', error);
        }
    }

    async _playlists(channel) {
        try {
            const playlistList = await Sonos.getPlaylist();

            if (!playlistList) {
                return this._slackMessage('There are no saved playlists!', channel);
            }

            const playlists = playlistList.items.map((playlist, index) => {
                const { title } = playlist;

                return `${index + 1}. ${title}`;
            });

            const message = [
                `:notebook: There are *${playlistList.returned}* playlists saved:`,
                `\`\`\`${playlists.join('\n')}\`\`\``,
            ].join('\n');

            this._slackMessage(message, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to get the playlists! :(`, channel);
            console.error('An error occurred getting the playlists:', error);
        }
    }

    async _setPlaylist(input, channel) {
        try {
            await Sonos.setAVTransportURI('spotify:user:umer_adam-gb:playlist:37i9dQZF1DX3PFzdbtx1Us');
            // if (!input || input.split(' ')[0] === '') {
            //     return this._slackMessage('You must specify a playlist ID to load!\n!setplaylist <ID>', channel);
            // }

            // const playlistId = input.split(' ')[0];

            // if ((!Number(playlistId) && Number(playlistId) !== 0) || isNaN(playlistId)) {
            //     return this._slackMessage(`*${playlistId}* is not a number!`, channel);
            // }

            // const playlistList = await Sonos.getPlaylist();

            // if (!playlistList) {
            //     return this._slackMessage('There are no saved playlists!', channel);
            // }

            // const playlist = playlistList.items[Number(playlistId) - 1];

            // if (!playlist) {
            //     return this._slackMessage(`There is no playlist with ID *${playlistId}*!`, channel);
            // }

            // const { title, uri } = playlist;

            // console.log(uri);
            // await Sonos.play(uri);

            // this._slackMessage(`:notes: Playlist *${title}* now playing! :notes:`, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to create the playlist! :(`, channel);
            console.error('An error occurred creating the playlist:', error);
        }
    }

    async _playmode(input, channel) {
        try {
            const currentPlaymode = await Sonos.getPlayMode();

            if (!input) {
                return this._slackMessage(`Current playmode is set to: *${currentPlaymode.toLowerCase()}*`, channel);
            }

            const playmode = _.snakeCase(input).toUpperCase();

            if (currentPlaymode === playmode) {
                return this._slackMessage(`The playmode is already set to that!`, channel);
            }

            if (!playmodes.includes(playmode)) {
                const playmodesFormatted = playmodes.map(mode => `*${_.lowerCase(mode)}*`).join(', ');

                return this._slackMessage(`That playmode is not recognised, the available playmodes are: ${playmodesFormatted}`, channel);
            }

            await Sonos.setPlayMode(playmode);

            this._slackMessage(`Playmode is now set to: ${input}`, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to get/change the playmode! :(`, channel);
            console.error('An error occurred getting/changing the playmode:', error);
        }
    }

    async _volume(input, channel) {
        try {
            const currentVolume = await Sonos.getVolume();

            if (!input || input.split(' ')[0] === '') {
                return this._slackMessage(`Current volume is set to: *${currentVolume}%*`, channel);
            }

            input = input.split(' ')[0];
            const numberedInput = Number(input);

            if (!(['up', 'down'].includes(input.toLowerCase()) || ((numberedInput || numberedInput === 0) && !isNaN(input) && (numberedInput >= 0) && (numberedInput <= volumeMax)))) {
                return this._slackMessage(`You can only turn the volume up/down or set it to a values between *0* and *${volumeMax}*!`, channel);
            }

            const newVolume = input === 'up' ? currentVolume + volumeInterval
                : input === 'down' ? currentVolume - volumeInterval
                    : numberedInput;

            await Sonos.setVolume(newVolume);

            this._slackMessage(`Volume is now set to: *${newVolume}%*`, channel);
        } catch (error) {
            this._slackMessage(`An error occurred trying to get/change the volume! :(`, channel);
            console.error('An error occurred getting/changing the volume:', error);
        }
    }
}

module.exports = SonosClass;
