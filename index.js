const Discord = require("discord.js");
const fs = require('fs');
const {Readable}=require('stream');
const {env}=require('process');
const {EventEmitter}=require('events');
const Mixer=require('audio-mixer');
const config = require('./auth.json');
require('dotenv').config();
const num_bots= parseInt(env.NUM_BOTS);

class Silence extends Readable{
  _read(){this.push(Buffer.from([0xF8,0xFF,0xFE]))}
}

class MixStream extends EventEmitter{
  constructor(rs_list=[]){
    super();
    this._mixer = new Mixer.Mixer({
      channels: 2,
      bitDepth: 16,
      sampleRate: 48000,
      clearInterval: 250,
      autoDestroy: false
    }).resume();
    for (var i = 0; i < rs_list.length; i++) {
      this.add_rs(rs_list[i]);
    }
  }
  add_rs=(rs)=>{
    var new_in=this._mixer.input({});
    rs.on('end',(()=>{
      this._mixer.removeInput(new_in);
      //if(this._mixer.inputs.length==0) this.close();
    }).bind(this))
    .on('close',(()=>{
      this._mixer.removeInput(new_in);
      //if(this._mixer.inputs.length==0) this.close();
    }).bind(this))
    .pipe(new_in);
  }
  close=(flg_close=true)=>{
    this._mixer.unpipe();
    this._mixer.close();
    this._mixer.destroy();
    if(flg_close) this.emit('close');
  }
  get mixer(){
    return this._mixer.resume();
  }
  reconnect=()=>{
    var inputs=this._mixer.inputs.concat();
    this.close(false);
    this._mixer = new Mixer.Mixer({
      channels: 2,
      bitDepth: 16,
      sampleRate: 48000,
      clearInterval: 250,
      autoDestroy: false
    }).resume();
    inputs.forEach(i=>{
      this._mixer.addInput(i);
      console.log(i);
    });
  }
}

class Unit{
  fn_in=(msg,g_id,ch_id)=>{
    let guild=this.client_in.guilds.cache.get(g_id);
    if(!guild){
      console.log('guild not found');
      return;
    }
    let v_ch=guild.channels.cache.get(ch_id);
    v_ch.join()
    .then(conn => {
      this.in_conn.set(g_id,conn);
      conn.play(new Silence,{type:'opus'});
      conn.on('speaking', (user, speaking) => {
        if(!(user&&speaking)) return;
        if(!this.in_user_ids.has(g_id)) this.in_user_ids.set(g_id,new Set());
        if (!this.in_user_ids.get(g_id).has(user.id)) {
          try{
            let rs=conn.receiver.createStream(user,{mode:'pcm'});
            if(this.in_user_ids.has(g_id)){
              this.in_user_ids.get(g_id).add(user.id);
            }else{
              this.in_user_ids.set(g_id,new Set([user.id]));
            }
            if(this.mix_stream.has(g_id)){
              this.mix_stream.get(g_id).add_rs(rs);
            }else{
              this.mix_stream.set(g_id,new MixStream([rs]));
              this.mix_stream.get(g_id).on('close',()=>this.mix_stream.delete(g_id));
              if(this.out_conn.has(g_id)) this.dispatchers.set(g_id, this.out_conn.get(g_id).play(this.mix_stream.get(g_id).mixer,{type:'converted',volume: this.vol.has(g_id)?this.vol.get(g_id):1}));
            }
            rs.on('end', (() => {
              this.in_user_ids.get(g_id).delete(user.id);
            }).bind(this));
          }catch(e){console.log(e)}
        }
      });
    })
    .catch(console.log);
  };
  fn_out=(msg,g_id,ch_id)=>{
    let guild=this.client_out.guilds.cache.get(g_id);
    if(!guild){
      console.log('guild not found');
      return;
    }
    let v_ch=guild.channels.cache.get(ch_id);
    v_ch.join()
    .then(conn => {
      this.out_conn.set(g_id,conn);
      conn.on('disconnect',()=>{
        if(this.out_conn.has(g_id)) this.out_conn.delete(g_id);
      });
      if(this.mix_stream.has(g_id)){this.mix_stream.get(g_id).close();}
      this.mix_stream.set(g_id,new MixStream());
      this.mix_stream.get(g_id).on('close',(()=>this.mix_stream.delete(g_id)).bind(this));
      this.dispatchers.set(g_id,this.out_conn.get(g_id).play(this.mix_stream.get(g_id).mixer,{type:'converted',volume: this.vol.has(g_id)?this.vol.get(g_id):1}));
    })
    .catch(console.log);
  };
  fn_leave=(msg,flg_out,g_id)=>{
    if(flg_out){
      if(this.out_conn.has(g_id)){
        this.out_conn.get(g_id).disconnect();
        //this.out_conn.delete(g_id);
      }
      if(this.vol.has(g_id))this.vol.delete(g_id,);
    }else{
      if(this.in_conn.has(g_id)) this.in_conn.get(g_id).disconnect();
      this.in_conn.delete(g_id);
      if(this.in_user_ids.has(g_id)) this.in_user_ids.get(g_id).clear();
      if(this.mix_stream.has(g_id)){
        this.mix_stream.get(g_id).close();
        this.mix_stream.delete(g_id);
      }
    }
  };
  fn_vol=(msg,vol,g_id)=>{
    if(this.dispatchers.has(g_id)) this.dispatchers.get(g_id).setVolume(vol);
    this.vol.set(vol);
  };

  constructor(id){
    this.id=id;
    this.client_in = new Discord.Client();
    this.client_out = new Discord.Client();

    this.token_in=env["DISCORD_TOKEN_IN_"+(this.id+1)];
    this.token_out=env[`DISCORD_TOKEN_OUT_1_${this.id+1}`];

    this.mix_stream=new Map();//guild->MixStream
    this.vol=new Map();//guild->Number (volume)
    this.in_user_ids=new Map();//guild->Set<user_id>
    this.in_conn=new Map();//guild->in_conn
    this.out_conn=new Map();//guild->out_conn
    this.dispatchers=new Map();//guild->StreamDispatcher
    this.fn=[this.fn_in,this.fn_out];

    this.client_in.login(this.token_in);
    this.client_out.login(this.token_out);
  }
}

class UnitManager{
  constructor(units){
    this.channels=[...Array(num_bots)].map(_=>[0,0]);//[unit_id][in/out]->ch_id
    this.ch2bots=new Map(); //guild->Map<ch_id,Set(bot_group_id)>
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
        this.units[Math.floor(i/2)].fn_leave(msg,i%2,msg.guild.id);
        this.channels[Math.floor(i/2)][i%2]=0;
        this.ch2bots.get(v_ch.id).delete(i);
      }
    }else if(msg.content.startsWith(config.prefix+'vol')){
      let [command, ...args]=msg.content.split(" ");
      let vol=args.pop();
      if(!isFinite(vol)){
        return msg.reply('Argument vol is not a number. Usage: ?relay_vol [ch_name(string)] [volume(number)]');
      }
      vol=parseInt(vol)/100;
      if (!msg.guild) {
        return msg.reply('no private service is available in your area at the moment. Please contact a service representative for more details.');
      }
      const v_ch = msg.guild.channels.cache.find(ch => ch.name === args.join(" "));
      if (!v_ch || v_ch.type !== 'voice') {
        return msg.reply(`I couldn't find the channel ${args}. Can you spell?`);
      }
      if(!this.ch2bots.has(v_ch.id)) return;
      for(let i of this.ch2bots.get(v_ch.id)){
        this.units[Math.floor(i/2)].fn_vol(msg,vol,msg.guild.id);
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
