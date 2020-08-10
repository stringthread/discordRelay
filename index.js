const Discord = require("discord.js");
const fs = require('fs');
const {Readable}=require('stream');
const {env}=require('process');
require('dotenv').config();

const client_in = new Discord.Client();
const client_out_1 = new Discord.Client();
const client_out_2 = new Discord.Client();

const token_in=env.DISCORD_TOKEN_IN;
const token_out_1=env.DISCORD_TOKEN_OUT_1;
const token_out_2=env.DISCORD_TOKEN_OUT_2;

const config = require('./auth.json');

class Silence extends Readable{
  _read(){this.push(Buffer.from([0xF8,0xFF,0xFE]))}
}

var in_audioStream=[null,null]
var in_user_ids=new Set()
var out_conn=[null,null]

var callback_out=(msg,n)=>{
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
        out_conn[n]=conn
        conn.play(new Silence,{type:'opus'});
        conn.on('disconnect',()=>{
          out_conn[n]=null;
        })
        if(in_audioStream[n]){
          out_conn[n].play(in_audioStream[n],{type:'opus'});
        }
      })
      .catch(console.log);
  }
  if(msg.content.startsWith(config.prefix+'leave')) {
    let [command, ...channelName] = msg.content.split(" ");
    let voiceChannel = msg.guild.channels.cache.find(ch => ch.name === channelName.join(" "));
    voiceChannel.leave();
  }
}

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
          if(!(user&&speaking)) return;
          if (speaking && !in_user_ids.has(user.id)) {
            console.log(`Speaking-${n}: ${user}`)
            // this creates a 16-bit signed PCM, stereo 48KHz PCM stream.
            var n=(in_audioStream[0]?(in_audioStream[1]?-1:1):0)
            if(n==-1){
              console.log('too many people speaking.');
              return;
            }
            try{
              in_audioStream[n] = conn.receiver.createStream(user,{mode:'opus'});
              in_user_ids.add(user.id)
            }catch(e){console.log(e)}
            if(out_conn[n] && !out_conn[n].voice.speaking){
              out_conn[n].play(in_audioStream[n],{type:'opus'})
            }
            // when the stream ends (the user stopped talking) tell the user
            in_audioStream[n].on('end', () => {
              console.log(`End Speaking-${n}: ${user}`);
              in_audioStream[n]=null
              in_user_ids.delete(user.id)
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
client_out_1.on('message', msg=>callback_out(msg,0));
client_out_2.on('message', msg=>callback_out(msg,1));

client_in.login(token_in);
client_out_1.login(token_out_1);
client_out_2.login(token_out_2);
