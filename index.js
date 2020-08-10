const Discord = require("discord.js");
const fs = require('fs');
const {Readable}=require('stream');
const process=require('process')

const client_in = new Discord.Client();
const client_out = new Discord.Client();

const config = require('./auth.json');

class Silence extends Readable{
  _read(){this.push(Buffer.from([0xF8,0xFF,0xFE]))}
}

// make a new stream for each time someone starts to talk
function generateOutputFile(channel, member) {
  // use IDs instead of username cause some people have stupid emojis in their name
  const fileName = `./recordings/${channel.id}-${member.id}-${Date.now()}.pcm`;
  return fs.createWriteStream(fileName);
}

var is_playing=false
var in_audioStream=null
var out_conn=null

client_in.on('message', msg => {
  if (msg.content.startsWith(config.prefix+'in')) {
    let [command, ...channelName] = msg.content.split(" ");
    if (!msg.guild) {
      return msg.reply('no private service is available in your area at the moment. Please contact a service representative for more details.');
    }
    const voiceChannel = msg.guild.channels.cache.find(ch => ch.name === channelName.join(" "));
    //console.log(voiceChannel.id);
    if (!voiceChannel || voiceChannel.type !== 'voice') {
      return msg.reply(`I couldn't find the channel ${channelName}. Can you spell?`);
    }
    voiceChannel.join()
      .then(conn => {
        msg.reply('ready!');
        conn.play(new Silence,{type:'opus'});
        //conn.on('speaking',(user,speaking)=>{console.log(`Speaking: ${user}, ${speaking}`)});
        conn.on('speaking', (user, speaking) => {
          if (speaking && !in_audioStream) {
            console.log(`Speaking: ${user}`)
            // this creates a 16-bit signed PCM, stereo 48KHz PCM stream.
            in_audioStream = conn.receiver.createStream(user,{mode:'opus'});
            if(out_conn && !is_playing){
              is_playing=true
              out_conn.play(in_audioStream,{type:'opus'})
            }
            // when the stream ends (the user stopped talking) tell the user
            in_audioStream.on('end', () => {
              console.log(`End Speaking: ${user}`);
              in_audioStream=null
              is_playing=false
            });
          }
        });
      })
      .catch(console.log);
  }
  if(msg.content.startsWith(config.prefix+'leave')) {
    let [command, ...channelName] = msg.content.split(" ");
    let voiceChannel = msg.guild.channels.cache.find(ch => ch.name === channelName.join(" "));
    voiceChannel.leave();
  }
});
client_out.on('message', msg => {
  if (msg.content.startsWith(config.prefix+'out')) {
    let [command, ...channelName] = msg.content.split(" ");
    if (!msg.guild) {
      return msg.reply('no private service is available in your area at the moment. Please contact a service representative for more details.');
    }
    const voiceChannel = msg.guild.channels.cache.find(ch => ch.name === channelName.join(" "));
    //console.log(voiceChannel.id);
    if (!voiceChannel || voiceChannel.type !== 'voice') {
      return msg.reply(`I couldn't find the channel ${channelName}. Can you spell?`);
    }
    voiceChannel.join()
      .then(conn => {
        msg.reply('ready!');
        out_conn=conn
        conn.play(new Silence,{type:'opus'});
        conn.on('disconnect',()=>{
          out_conn=null
        })
      })
      .catch(console.log);
  }
  if(msg.content.startsWith(config.prefix+'leave')) {
    let [command, ...channelName] = msg.content.split(" ");
    let voiceChannel = msg.guild.channels.cache.find(ch => ch.name === channelName.join(" "));
    voiceChannel.leave();
  }
});

client_in.login(process.env.DISCORD_TOKEN_IN);
client_out.login(process.env.DISCORD_TOKEN_OUT);
