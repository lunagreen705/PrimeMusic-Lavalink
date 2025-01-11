const { Riffy } = require("riffy");
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { Dynamic } = require("musicard");
const config = require("./config.js");
const fs = require("fs");
const path = require("path");
const { queueNames, requesters } = require("./commands/play");

function initializePlayer(client) {
    const nodes = config.nodes.map((node) => ({
        name: node.name,
        host: node.host,
        port: node.port,
        password: node.password,
        secure: node.secure,
        reconnectTimeout: 5000,
        reconnectTries: Infinity,
    }));

    client.riffy = new Riffy(client, nodes, {
        send: (payload) => {
            const guildId = payload.d.guild_id;
            if (!guildId) return;

            const guild = client.guilds.cache.get(guildId);
            if (guild) guild.shard.send(payload);
        },
        defaultSearchPlatform: "ytmsearch",
        restVersion: "v4",
    });

    let currentTrackMessageId = null;
    let collector = null;

    // Node event listeners
    client.riffy.on("nodeConnect", (node) => console.log(`Node "${node.name}" connected.`));
    client.riffy.on("nodeError", (node, error) => console.error(`Node "${node.name}" error: ${error.message}.`));

    // Track start event
    client.riffy.on("trackStart", async (player, track) => {
        const channel = client.channels.cache.get(player.textChannel);
        const trackUri = track.info.uri;
        const requester = requesters.get(trackUri);

        try {
            const musicard = await generateMusicCard(track);
            const attachment = new AttachmentBuilder(musicard.path, { name: 'musicard.png' });

            const embed = new EmbedBuilder()
                .setAuthor({
                    name: 'Now Playing',
                    iconURL: 'https://cdn.discordapp.com/emojis/838704777436200981.gif'
                })
                .setDescription('🎶 **Controls:**\n 🔁 `Loop`, ❌ `Disable`, ⏭️ `Skip`, 📜 `Queue`, 🗑️ `Clear`\n ⏹️ `Stop`, ⏸️ `Pause`, ▶️ `Resume`, 🔊 `Vol +`, 🔉 `Vol -`')
                .setImage('attachment://musicard.png')
                .setColor('#FF7A00');

            const actionRow1 = createActionRow1(false);
            const actionRow2 = createActionRow2(false);

            const message = await channel.send({
                embeds: [embed],
                files: [attachment],
                components: [actionRow1, actionRow2],
            });
            currentTrackMessageId = message.id;

            if (collector) collector.stop();
            collector = setupCollector(client, player, channel, message);

        } catch (error) {
            console.error("Error creating or sending music card:", error.message);
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setDescription("⚠️ **Unable to load track card. Continuing playback...**");
            await channel.send({ embeds: [errorEmbed] });
        }
    });

    // Track end event
    client.riffy.on("trackEnd", async (player) => {
        await disableTrackMessage(client, player);
        currentTrackMessageId = null;
    });

    // Player disconnect event
    client.riffy.on("playerDisconnect", async (player) => {
        await disableTrackMessage(client, player);
        currentTrackMessageId = null;
    });

    // Queue end event
    client.riffy.on("queueEnd", async (player) => {
        const channel = client.channels.cache.get(player.textChannel);
        if (channel && currentTrackMessageId) {
            const queueEmbed = new EmbedBuilder()
                .setColor(config.embedColor)
                .setDescription('**Queue Songs ended! Disconnecting Bot!**');
            await channel.send({ embeds: [queueEmbed] });
        }
        player.destroy();
        currentTrackMessageId = null;
    });
}

async function generateMusicCard(track) {
    try {
        const musicard = await Dynamic({
            thumbnailImage: track.info.thumbnail || 'https://example.com/default_thumbnail.png',
            backgroundColor: '#070707',
            progress: 10,
            progressColor: '#FF7A00',
            progressBarColor: '#5F2D00',
            name: track.info.title,
            nameColor: '#FF7A00',
            author: track.info.author || 'Unknown Artist',
            authorColor: '#696969',
        });
        
        const cardPath = path.join(__dirname, 'musicard.png');
        fs.writeFileSync(cardPath, musicard);
        return { path: cardPath };
    } catch (error) {
        console.error("Error generating music card:", error.message);
        throw new Error('Failed to generate music card');
    }
}

async function disableTrackMessage(client, player) {
    const channel = client.channels.cache.get(player.textChannel);
    if (!channel || !currentTrackMessageId) return;

    try {
        const message = await channel.messages.fetch(currentTrackMessageId);
        if (message) {
            const disabledRow1 = createActionRow1(true);
            const disabledRow2 = createActionRow2(true);
            await message.edit({ components: [disabledRow1, disabledRow2] });
        }
    } catch (error) {
        console.error("Failed to disable message components:", error);
    }
}

module.exports = { initializePlayer };
