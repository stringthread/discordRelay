const Discord = require("discord.js");
const fs = require('fs');
const {Readable}=require('stream');
const {env}=require('process');
const config = require('./auth.json');
require('dotenv').config();

class Silence extends Readable{
  _read(){this.push(Buffer.from([0xF8,0xFF,0xFE]))}
}

class Unit{
  static channels=[[0,0,0],[0,0,0],[0,0,0],[0,0,0]]; //channnel-id of [in,out_1,out_2]
  static ch2bot=new Map(); //ch2bot[ch_id]->bot id

  //n: 0 for in. 1 for out_1. 2 for out_2.
  get_bot_id=(n)=>{
    return this.id*3+n;
  }

  sel_bot=(ch_id,n,flg_con=true)=>{
    if(Unit.channels[this.id][n]) return false;
    if(Unit.ch2bot.has(ch_id)){
      var conn_id=Unit.ch2bot.get(ch_id);
      if(conn_id%3==n) return conn_id==this.get_bot_id(n);
    }
    for (var i = 0; i < this.id; i++) {
      if(!Unit.channels[i][n]) return false;
    }
    return true;
  }

  callback_out=(msg,n)=>{
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
      if(!this.sel_bot(voiceChannel.id,n)) return;
      voiceChannel.join()
        .then(conn => {
          Unit.channels[this.id][n+1]=voiceChannel.id;
          Unit.ch2bot.set(voiceChannel.id,this.get_bot_id(n));
          msg.reply('ready!');
          this.out_conn[n]=conn
          conn.play(new Silence,{type:'opus'});
          conn.on('disconnect',()=>{
            this.out_conn[n]=null;
            Unit.channels[this.id][n+1]=0;
          })
          if(this.in_audioStream[n]){
            this.out_conn[n].play(this.in_audioStream[n],{type:'opus'});
          }
        })
        .catch(console.log);
    }
    if(msg.content.startsWith(config.prefix+'leave')) {
      let [command, ...channelName] = msg.content.split(" ");
      let voiceChannel = msg.guild.channels.cache.find(ch => ch.name === channelName.join(" "));
      voiceChannel.leave();
      Unit.channels[this.id][n]=0;
      Unit.ch2bot.delete(voiceChannel.id);
    }
  }

  constructor(id){
    this.id=id
    this.client_in = new Discord.Client();
    this.client_out_1 = new Discord.Client();
    this.client_out_2 = new Discord.Client();

    this.token_in=env["DISCORD_TOKEN_IN_"+(this.id+1)];
    this.token_out_1=env["DISCORD_TOKEN_OUT_1_"+(this.id+1)];
    this.token_out_2=env["DISCORD_TOKEN_OUT_2_"+(this.id+1)];

    this.in_audioStream=[null,null]
    this.in_user_ids=new Set()
    this.out_conn=[null,null]

    this.client_in.on('message', msg => {
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
        if(!this.sel_bot(voiceChannel.id,0)) return;
        voiceChannel.join()
          .then(conn => {
            Unit.channels[this.id][0]=voiceChannel.id;
            Unit.ch2bot.set(voiceChannel.id,this.get_bot_id(0));
            msg.reply('ready!');
            conn.play(new Silence,{type:'opus'});
            //conn.on('speaking',(user,speaking)=>{console.log(`Speaking: ${user}, ${speaking}`)});
            conn.on('speaking', (user, speaking) => {
              if(!(user&&speaking)) return;
              if (speaking && !this.in_user_ids.has(user.id)) {
                // this creates a 16-bit signed PCM, stereo 48KHz PCM stream.
                var n=(this.in_audioStream[0]?(this.in_audioStream[1]?-1:1):0)
                console.log(`Speaking-${n}: ${user}`)
                if(n==-1){
                  console.log('too many people speaking.');
                  return;
                }
                try{
                  this.in_audioStream[n] = conn.receiver.createStream(user,{mode:'opus'});
                  this.in_user_ids.add(user.id)
                }catch(e){console.log(e)}
                if(this.out_conn[n] && !this.out_conn[n].voice.speaking){
                  this.out_conn[n].play(this.in_audioStream[n],{type:'opus'})
                }
                // when the stream ends (the user stopped talking) tell the user
                this.in_audioStream[n].on('end', () => {
                  console.log(`End Speaking-${n}: ${user}`);
                  this.in_audioStream[n]=null
                  this.in_user_ids.delete(user.id)
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
        Unit.channels[this.id][0]=0;
        Unit.ch2bot.delete(voiceChannel.id);
      }
    });
    this.client_out_1.on('message', (msg=>this.callback_out(msg,0)).bind(this));
    this.client_out_2.on('message', (msg=>this.callback_out(msg,1)).bind(this));

    this.client_in.login(this.token_in);
    this.client_out_1.login(this.token_out_1);
    this.client_out_2.login(this.token_out_2);
  }
}

var unit=[...Array(env.NUM_BOTS)].map((_, i) => new Unit(i));
