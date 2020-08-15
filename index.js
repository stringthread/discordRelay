const Discord = require("discord.js");
const fs = require('fs');
const {Readable}=require('stream');
const {env}=require('process');
const config = require('./auth.json');
require('dotenv').config();
const num_bots= parseInt(env.NUM_BOTS);
const num_outs=parseInt(env.NUM_OUTS);

class Silence extends Readable{
  _read(){this.push(Buffer.from([0xF8,0xFF,0xFE]))}
}

class Unit{
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

  fn_in=(msg,g_id,ch_id)=>{
    let guild=this.client_in.guilds.cache.get(g_id);
    if(!guild){
      console.log('guild not found');
      return;
    }
    let v_ch=guild.channels.cache.get(ch_id);
    v_ch.join()
    .then(conn => {
      this.in_conn=conn;
      msg.reply('ready!');
      conn.play(new Silence,{type:'opus'});
      //conn.on('speaking',(user,speaking)=>{console.log(`Speaking: ${user}, ${speaking}`)});
      conn.on('speaking', (user, speaking) => {
        if(!(user&&speaking)) return;
        if (speaking && !this.in_user_ids.has(user.id)) {
          // this creates a 16-bit signed PCM, stereo 48KHz PCM stream.
          var n=this.in_audioStream.findIndex(v=>!v);
          console.log(`Speaking-${n}: ${user}`)
          if(n==-1){
            console.log('too many people speaking.');
            return;
          }
          try{
            this.in_audioStream[n] = conn.receiver.createStream(user,{mode:'opus', end:'silence'});
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
  };
  fn_out=(msg,g_id,ch_id)=>{
    this.clients_out.forEach((v,i)=>{
      let guild=v.guilds.cache.get(g_id);
      if(!guild){
        console.log('guild not found');
        return;
      }
      let v_ch=guild.channels.cache.get(ch_id);
      v_ch.join()
      .then(conn => {
        msg.reply('ready!');
        this.out_conn[i]=conn
        conn.play(new Silence,{type:'opus'});
        conn.on('disconnect',()=>{
          this.out_conn[i]=null;
        })
        if(this.in_audioStream[i]){
          this.out_conn[i].play(this.in_audioStream[i],{type:'opus'});
        }
      })
      .catch(console.log);
    });
  };
  fn_leave=(msg,flg_out)=>{
    if(flg_out){
      this.out_conn.forEach((v,i)=>{
        if(v) v.disconnect();
        this.out_conn[i]=null;
      });
    }else{
      if(this.in_conn) this.in_conn.disconnect();
      this.in_conn=null;
    }
  };

  /*callback_out=(msg,n)=>{
    if (msg.content.startsWith(config.prefix+'out')) {
      let [command, ...channelName] = msg.content.split(" ");
      if (!msg.guild) {
        return msg.reply('no private service is available in your area at the moment. Please contact a service representative for more details.');
      }
      const v_ch = msg.guild.channels.cache.find(ch => ch.name === channelName.join(" "));
      //console.log(v_ch.id);
      if (!v_ch || v_ch.type !== 'voice') {
        return msg.reply(`I couldn't find the channel ${channelName}. Can you spell?`);
      }
      if(!this.sel_bot(v_ch.id,n)) return;
      v_ch.join()
        .then(conn => {
          Unit.channels[this.id][n+1]=v_ch.id;
          Unit.ch2bot.set(v_ch.id,this.get_bot_id(n));
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
      let v_ch = msg.guild.channels.cache.find(ch => ch.name === channelName.join(" "));
      v_ch.leave();
      Unit.channels[this.id][n]=0;
      Unit.ch2bot.delete(v_ch.id);
    }
  }*/

  constructor(id){
    this.id=id
    this.client_in = new Discord.Client();
    this.clients_out = [...Array(num_outs)].map(_=>new Discord.Client());

    this.token_in=env["DISCORD_TOKEN_IN_"+(this.id+1)];
    this.tokens_out=[...Array(num_outs)].map((_,i)=>env[`DISCORD_TOKEN_OUT_${i+1}_${this.id+1}`]);

    this.in_audioStream=[...Array(num_outs)];
    this.in_user_ids=new Set();
    this.in_conn=null;
    this.out_conn=[...Array(num_outs)];
    this.fn=[this.fn_in,this.fn_out];

    /*this.client_in.on('message', msg => {
      if (msg.content.startsWith(config.prefix+'in')) {
        let [command, ...channelName] = msg.content.split(" ");
        if (!msg.guild) {
          return msg.reply('no private service is available in your area at the moment. Please contact a service representative for more details.');
        }
        const v_ch = msg.guild.channels.cache.find(ch => ch.name === channelName.join(" "));
        //console.log(v_ch.id);
        if (!v_ch || v_ch.type !== 'voice') {
          return msg.reply(`I couldn't find the channel ${channelName}. Can you spell?`);
        }
        if(!this.sel_bot(v_ch.id,0)) return;
        v_ch.join()
          .then(conn => {
            Unit.channels[this.id][0]=v_ch.id;
            Unit.ch2bot.set(v_ch.id,this.get_bot_id(0));
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
        let v_ch = msg.guild.channels.cache.find(ch => ch.name === channelName.join(" "));
        v_ch.leave();
        Unit.channels[this.id][0]=0;
        Unit.ch2bot.delete(v_ch.id);
      }
    });
    this.client_out_1.on('message', (msg=>this.callback_out(msg,0)).bind(this));
    this.client_out_2.on('message', (msg=>this.callback_out(msg,1)).bind(this));
    */

    this.client_in.login(this.token_in);
    this.clients_out.forEach((v,i)=>v.login(this.tokens_out[i]));
  }
}

class UnitManager{
  constructor(units){
    this.channels=[...Array(num_bots)].map(_=>[0,0]);//[unit_id][in/out]->ch_id
    this.ch2bots=new Map(); //ch_id->Set(bot_group_id)
    this.units=units;
    this.client=units[0].client_in; //use only to get message event
    this.client.on('message',this.msg_callback);
  }
  msg_callback=(msg)=>{
    if(msg.content.startsWith(config.prefix+'in')){
      this.fn_join(msg,0);
    }else if(msg.content.startsWith(config.prefix+'out')){
      this.fn_join(msg,1);
    }else if(msg.content.startsWith(config.prefix+'leave')){
      let [command, ...channelName] = msg.content.split(" ");
      if (!msg.guild) {
        return msg.reply('no private service is available in your area at the moment. Please contact a service representative for more details.');
      }
      const v_ch = msg.guild.channels.cache.find(ch => ch.name === channelName.join(" "));
      if (!v_ch || v_ch.type !== 'voice') {
        return msg.reply(`I couldn't find the channel ${channelName}. Can you spell?`);
      }
      if(!this.ch2bots.has(v_ch.id)) return;
      for(let i of this.ch2bots.get(v_ch.id)){
        this.units[Math.floor(i/2)].fn_leave(msg,i%2);
      }
    }
  };

  //in_out: 0 for in, 1 for out
  fn_join=(msg,in_out)=>{
    let [command, ...channelName] = msg.content.split(" ");
    if (!msg.guild) {
      return msg.reply('no private service is available in your area at the moment. Please contact a service representative for more details.');
    }
    const v_ch = msg.guild.channels.cache.find(ch => ch.name === channelName.join(" "));
    if (!v_ch || v_ch.type !== 'voice') {
      return msg.reply(`I couldn't find the channel ${channelName}. Can you spell?`);
    }
    let set_conn=this.ch2bots.get(v_ch.id);
    let i=0;
    for(;i<this.units.length;i++){
      if(this.channels[i][in_out]) continue;
      if(set_conn&&set_conn.has(2*i+1-in_out)) continue; //if partner already connected to the same ch, unavailable
      break;
    }
    if(i>=this.units.length){
      msg.reply('Bots all used...');
      return;
    }
    this.channels[i][in_out]=v_ch.id;
    if(!set_conn) this.ch2bots.set(v_ch.id,new Set());
    this.ch2bots.get(v_ch.id).add(2*i+in_out);
    this.units[i].fn[in_out](msg,msg.guild.id,v_ch.id);
  }
}

var units=[...Array(num_bots)].map((_, i) => new Unit(i));
var unit_m=new UnitManager(units);
