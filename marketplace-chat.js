/* ── Chat Dropdown + Notifikace ── */
(function(){
  'use strict';
  var POLL=8000;
  var SBU=typeof SUPABASE_URL!=='undefined'?SUPABASE_URL:'https://xrduqwrinzvmpixgmqta.supabase.co';
  var SBA=typeof SUPABASE_ANON!=='undefined'?SUPABASE_ANON:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';
  var tk=localStorage.getItem('sb_token');
  var su=(function(){try{return JSON.parse(localStorage.getItem('sb_user')||'null')}catch(e){return null}})();
  if(!tk||!su||!su.id)return;
  var uid=su.id,convs=[],prevUn=0,dropO=false;
  function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  function fmtT(iso){if(!iso)return'';var d=new Date(iso),n=new Date(),df=n-d;if(df<60000)return'teď';if(df<3600000)return Math.floor(df/60000)+' min';if(d.toDateString()===n.toDateString())return d.toLocaleTimeString('cs',{hour:'2-digit',minute:'2-digit'});var y=new Date(n);y.setDate(y.getDate()-1);if(d.toDateString()===y.toDateString())return'včera';return d.toLocaleDateString('cs',{day:'numeric',month:'numeric'})}
  async function sbF(p){try{var r=await fetch(SBU+'/'+p,{headers:{'Content-Type':'application/json','apikey':SBA,'Authorization':'Bearer '+tk}});var d=await r.json();return Array.isArray(d)?d:[]}catch(e){return[]}}
  window.toggleChatDrop=function(){var dr=document.getElementById('chatDrop');if(!dr)return;dropO=!dropO;dr.classList.toggle('open',dropO);if(dropO)renderDrop()};
  document.addEventListener('click',function(e){var w=document.getElementById('chatDropWrap');if(w&&!w.contains(e.target)&&dropO){dropO=false;var dr=document.getElementById('chatDrop');if(dr)dr.classList.remove('open')}});
  function renderDrop(){
    var list=document.getElementById('chatDropList');if(!list)return;
    if(!convs.length){list.innerHTML='<div class="chat-drop-empty"><div style="font-size:24px;margin-bottom:6px;opacity:0.4">💬</div><div>Žádné zprávy</div></div>';return}
    list.innerHTML=convs.slice(0,8).map(function(c){
      var isU1=c.user1_id===uid,partner=isU1?c.user2_username:c.user1_username;
      var un=isU1?(c.unread_user1||0):(c.unread_user2||0);
      var ini=(partner||'?')[0].toUpperCase(),msg=c.last_message_text||'Nová konverzace',tm=fmtT(c.last_message_at);
      var hasL=msg.indexOf('📎')>=0||msg.indexOf('Nabídka')>=0;
      return '<a class="cdrop-item'+(un>0?' unread':'')+'" href="chat.html?conv='+c.id+'">'
        +'<div class="cdrop-avatar">'+esc(ini)+'</div>'
        +'<div class="cdrop-info"><div class="cdrop-top"><div class="cdrop-name">'+esc(partner)+'</div><div class="cdrop-time">'+esc(tm)+'</div></div>'
        +'<div class="cdrop-msg">'+esc(msg)+'</div>'
        +(hasL?'<div class="cdrop-listing"><div class="cdrop-listing-dot"></div> Nabídka z marketplace</div>':'')
        +'</div>'+(un>0?'<div class="cdrop-unread-dot"></div>':'')+'</a>'
    }).join('');
    if(window.Notification&&Notification.permission==='default'&&!localStorage.getItem('pkt_notif_dismissed')&&!document.getElementById('notifPrompt')){
      var pr=document.createElement('div');pr.className='notif-prompt show';pr.id='notifPrompt';
      pr.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(74,158,255,0.7)" stroke-width="2" style="flex-shrink:0"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg><span style="flex:1">Oznámení o nových zprávách?</span><button class="notif-prompt-btn notif-allow" onclick="requestNotifPerm()">Povolit</button><button class="notif-prompt-btn notif-dismiss" onclick="dismissNotifPrompt()">Ne</button>';
      document.getElementById('chatDrop').appendChild(pr)
    }
  }
  window.requestNotifPerm=async function(){if(!window.Notification)return;await Notification.requestPermission();var p=document.getElementById('notifPrompt');if(p)p.remove()};
  window.dismissNotifPrompt=function(){localStorage.setItem('pkt_notif_dismissed','1');var p=document.getElementById('notifPrompt');if(p)p.remove()};
  function showNotif(title,body){if(!window.Notification||Notification.permission!=='granted')return;try{var n=new Notification(title,{body:body,icon:'pokemon.png',tag:'poketrade-msg',renotify:true});n.onclick=function(){window.focus();window.location.href='chat.html';n.close()};setTimeout(function(){n.close()},6000)}catch(e){}}
  async function poll(){
    convs=await sbF('rest/v1/conversations?or=(user1_id.eq.'+uid+',user2_id.eq.'+uid+')&order=last_message_at.desc&limit=15');
    var tot=convs.reduce(function(s,c){return s+(c.user1_id===uid?(c.unread_user1||0):(c.unread_user2||0))},0);
    var bg=document.getElementById('chatBadge');
    if(bg){if(tot>0){bg.textContent=tot>99?'99+':tot;bg.style.display=''}else{bg.style.display='none'}}
    if(tot>prevUn&&prevUn>=0&&document.hidden){
      var nc=convs.find(function(c){var u=c.user1_id===uid?(c.unread_user1||0):(c.unread_user2||0);return u>0&&c.last_sender_id!==uid});
      if(nc){var pn=nc.user1_id===uid?nc.user2_username:nc.user1_username;showNotif(pn+' – PokéTrade',(nc.last_message_text||'Nová zpráva').slice(0,80))}
    }
    prevUn=tot;
    if(dropO)renderDrop();
    if(tot>0){var bt=document.title.replace(/^\(\d+\)\s*/,'');document.title='('+tot+') '+bt}else{document.title=document.title.replace(/^\(\d+\)\s*/,'')}
  }
  poll();setInterval(poll,POLL);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)poll()});
})();
