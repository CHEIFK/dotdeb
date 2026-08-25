const ID="osho-audio-discourses-collection";
const ROOT="OSHO_WORLD/Hindi";
const API=`https://archive.org/metadata/${ID}`;
const IMG="osho-talks.png";
const CACHE_KEY="oshoHindiIndexV2";
const CACHE_MAX_AGE=7*24*60*60*1000;
const PAGE_SIZE=48;

const $=s=>document.querySelector(s);
const audio=$("#audio"),content=$("#content"),search=$("#search");
$("#heroArt").src=IMG; $("#nowArt").src=IMG;

let files=[],collections=[],currentCollection=null,current=-1,view="collections",visibleTracks=[],shownCollections=PAGE_SIZE;
let pendingPlay=null;
let activeSequence=()=>visibleTracks;

const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const nameOf=p=>{let n=p.split("/").pop();try{n=decodeURIComponent(n)}catch{}return n};
const pretty=n=>nameOf(n).replace(/\.[^.]+$/,"").replace(/[_-]+/g," ").replace(/\s+/g," ").trim();
const audioFile=n=>/\.(mp3|m4a|ogg|wav|flac|aac)$/i.test(n);
const audioURL=n=>`https://archive.org/download/${ID}/${n.split("/").map(encodeURIComponent).join("/")}`;
const json=k=>{try{const v=JSON.parse(localStorage.getItem(k)||"[]");return Array.isArray(v)?v:[]}catch{return[]}};
const hasFavorite=(key,value)=>json(key).includes(value);
const toggleFavorite=(key,value)=>{const items=json(key);const i=items.indexOf(value);if(i>=0)items.splice(i,1);else items.unshift(value);localStorage.setItem(key,JSON.stringify(items));return i<0};
const fmtSize=b=>{let n=Number(b);if(!Number.isFinite(n))return"";if(n>=1073741824)return(n/1073741824).toFixed(1)+" GB";if(n>=1048576)return(n/1048576).toFixed(1)+" MB";if(n>=1024)return(n/1024).toFixed(1)+" KB";return n+" B"};

function collectionArt(){return IMG}

function normalizeFiles(raw){
  return raw.filter(f=>f?.name&&f.name.startsWith(ROOT+"/")&&audioFile(f.name)).map(f=>({
    name:f.name,size:f.size||"",length:f.length||"",format:f.format||""
  }));
}

function saveCache(){
  try{localStorage.setItem(CACHE_KEY,JSON.stringify({saved:Date.now(),files}))}catch{}
}

function loadCache(){
  try{
    const c=JSON.parse(localStorage.getItem(CACHE_KEY)||"null");
    if(c?.files?.length&&Array.isArray(c.files)){
      const age=Date.now()-Number(c.saved||0);
      if(Number.isFinite(age)&&age>=0&&age<=CACHE_MAX_AGE){
        files=normalizeFiles(c.files);buildCollections();return true;
      }
      localStorage.removeItem(CACHE_KEY);
    }
  }catch{}
  return false;
}

function buildCollections(){
  const map=new Map();
  for(const f of files){
    const rest=f.name.slice((ROOT+"/").length);
    const folder=rest.split("/")[0];
    if(!folder)continue;
    if(!map.has(folder))map.set(folder,{folder,tracks:[]});
    map.get(folder).tracks.push(f);
  }
  collections=[...map.values()].sort((a,b)=>a.folder.localeCompare(b.folder,undefined,{numeric:true}));
}

function setCommonPage(title,heroTitle,heroText,placeholder){
  $("#pageTitle").textContent=title;
  $("#heroTitle").textContent=heroTitle;
  $("#heroText").textContent=heroText;
  search.placeholder=placeholder;
}

function renderCollections(){
  currentCollection=null;
  visibleTracks=[];
  $("#backToCollections").classList.add("hidden");
  setCommonPage("Hindi Discourses","Hindi Discourses","Browse the library by discourse collection. Open a collection to see its audio playlist.","Search collections...");
  $("#heroPlay").style.display="none";
  $("#heroFavorite").style.display="none";
  $("#sectionTitle").textContent=view==="favorites"?"Favorite collections":"Collections";

  const q=search.value.trim().toLowerCase();
  const favSet=new Set(json("favoriteCollections"));
  let list=collections.filter(c=>pretty(c.folder).toLowerCase().includes(q));
  if(view==="favorites")list=list.filter(c=>favSet.has(c.folder));

  $("#count").textContent=`${list.length} ${list.length===1?"collection":"collections"}`;
  content.className="collection-grid";
  if(!list.length){content.innerHTML='<div class="empty">No collections found.</div>';return}

  const end=Math.min(shownCollections,list.length);
  content.innerHTML=list.slice(0,end).map(c=>{
    const fav=favSet.has(c.folder);
    return `<article class="collection-card" data-folder="${esc(c.folder)}">
      <div class="card-art"><img loading="lazy" src="${IMG}" alt="OSHO Talks"></div>
      <div class="card-body"><div class="card-title">${esc(pretty(c.folder))}</div><div class="card-meta">${c.tracks.length} ${c.tracks.length===1?"audio":"audio files"}</div>
      <div class="card-actions"><button class="card-action ${fav?"favorite-active":""}" data-favorite-collection="${esc(c.folder)}" aria-label="Favorite"><svg viewBox="0 0 24 24" fill="${fav?"currentColor":"none"}"><path d="m12 19-7-5.2A4.4 4.4 0 0 1 10 6l2 2 2-2a4.4 4.4 0 0 1 5 7.8L12 19Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button></div></div>
    </article>`;
  }).join("");
  if(end<list.length)content.insertAdjacentHTML("beforeend",`<button class="load-more" id="loadMore">Load more · ${list.length-end} remaining</button>`);
}

function openCollection(folder){
  const found=collections.find(c=>c.folder===folder);
  if(!found)return;
  currentCollection=found;
  view="playlist";
  visibleTracks=currentCollection.tracks.slice();
  search.value="";
  $("#backToCollections").classList.remove("hidden");
  $("#pageTitle").textContent=pretty(folder);
  $("#heroTitle").textContent=pretty(folder);
  $("#heroText").textContent=`${currentCollection.tracks.length} audio tracks · Stream directly from Archive.org.`;
  $("#heroArt").src=IMG;
  $("#heroPlay").style.display="inline-flex";
  $("#heroFavorite").style.display="grid";
  const fav=hasFavorite("favoriteCollections",folder);
  $("#heroFavorite").classList.toggle("favorite-active",fav);
  $("#heroFavorite svg").setAttribute("fill",fav?"currentColor":"none");
  $("#sectionTitle").textContent="Playlist";
  search.placeholder="Search tracks...";
  renderPlaylist();
}

function renderPlaylist(){
  if(!currentCollection)return;
  const q=search.value.trim().toLowerCase();
  visibleTracks=currentCollection.tracks.filter(f=>pretty(f.name).toLowerCase().includes(q));
  $("#count").textContent=`${visibleTracks.length} ${visibleTracks.length===1?"track":"tracks"}`;
  content.className="playlist";
  if(!visibleTracks.length){content.innerHTML='<div class="empty">No tracks found.</div>';return}
  const favSet=new Set(json("favoriteTracks"));
  content.innerHTML=visibleTracks.map((f,i)=>{
    const playing=files[current]?.name===f.name;
    const fav=favSet.has(f.name);
    return `<div class="playlist-row ${playing?"playing":""}">
    <div class="track-num">${i+1}</div><div><div class="track-title">${esc(pretty(f.name))}</div><div class="track-meta">${esc((f.format||"Audio").toUpperCase())}</div></div><div class="track-size">${fmtSize(f.size)}</div>
    <div class="track-actions"><button class="track-action ${fav?"favorite-active":""}" data-favorite-track="${esc(f.name)}" aria-label="Favorite"><svg viewBox="0 0 24 24" fill="${fav?"currentColor":"none"}"><path d="m12 19-7-5.2A4.4 4.4 0 0 1 10 6l2 2 2-2a4.4 4.4 0 0 1 5 7.8L12 19Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>
    <button class="track-play track-action" data-track="${esc(f.name)}" aria-label="Play"><svg viewBox="0 0 24 24" fill="currentColor">${playing&&!audio.paused?'<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>':'<path d="M8 5.5v13a1 1 0 0 0 1.53.85l9.5-6.5a1 1 0 0 0 0-1.7l-9.5-6.5A1 1 0 0 0 8 5.5Z"/>'}</svg></button></div></div>`;
  }).join("");
}

function collectionForFile(file){
  const rest=file.name.slice((ROOT+"/").length);
  const folder=rest.split("/")[0];
  return collections.find(c=>c.folder===folder)||null;
}

function playFile(file){
  if(!file?.name)return;
  const idx=files.findIndex(f=>f.name===file.name);
  if(idx<0)return;

  current=idx;
  const collection=collectionForFile(file);
  pendingPlay={name:file.name,pos:Number(localStorage.getItem("pos:"+file.name)||0)};

  audio.src=audioURL(file.name);
  audio.load();
  $("#nowTitle").textContent=pretty(file.name);
  $("#nowSub").textContent=collection?pretty(collection.folder):"OSHO · Hindi";

  let recent=json("recent").filter(x=>x!==file.name);
  recent.unshift(file.name);
  localStorage.setItem("recent",JSON.stringify(recent.slice(0,100)));

  if(view==="playlist"&&currentCollection)renderPlaylist();
  else if(view==="recent")renderRecent();
  else if(view==="favorites")renderFavorites();

  audio.play().catch(err=>{
    pendingPlay=null;
    $("#nowSub").textContent="Playback failed · try again";
    console.warn("Audio playback failed:",err);
  });
}

audio.addEventListener("loadedmetadata",()=>{
  if(pendingPlay){
    try{
      const pos=Number.isFinite(pendingPlay.pos)?Math.max(0,pendingPlay.pos):0;
      audio.currentTime=Number.isFinite(audio.duration)?Math.min(pos,Math.max(0,audio.duration-0.5)):pos;
    }catch{}
    pendingPlay=null;
  }
});

function playVisible(i){if(visibleTracks[i])playFile(visibleTracks[i])}

function move(delta){
  const sequence=activeSequence();
  if(!sequence.length)return;

  const currentName=files[current]?.name;
  let index=sequence.findIndex(f=>f.name===currentName);

  // If filtering hides the current track, start at the nearest valid edge.
  if(index<0)index=delta>0?-1:sequence.length;

  const nextIndex=index+delta;
  if(nextIndex>=0&&nextIndex<sequence.length)playFile(sequence[nextIndex]);
}

content.addEventListener("click",e=>{
  const more=e.target.closest("#loadMore");
  if(more){shownCollections+=PAGE_SIZE;renderCollections();return}

  const favCollection=e.target.closest("[data-favorite-collection]");
  if(favCollection){
    e.stopPropagation();
    toggleFavorite("favoriteCollections",favCollection.dataset.favoriteCollection);
    if(view==="favorites")renderFavorites();else renderCollections();
    return;
  }

  const favTrack=e.target.closest("[data-favorite-track]");
  if(favTrack){
    e.stopPropagation();
    toggleFavorite("favoriteTracks",favTrack.dataset.favoriteTrack);
    if(view==="playlist")renderPlaylist();
    else if(view==="recent")renderRecent();
    else if(view==="favorites")renderFavorites();
    return;
  }

  const download=e.target.closest("[data-download]");
  if(download){
    e.preventDefault();
    downloadAudio(download.dataset.download);
    return;
  }

  const card=e.target.closest("[data-folder]");
  if(card&&!e.target.closest("button,a")){openCollection(card.dataset.folder);return}

  const track=e.target.closest("[data-track]");
  if(track){
    const f=files.find(x=>x.name===track.dataset.track);
    if(f)playFile(f);
  }
});

async function downloadAudio(name){
  const url=audioURL(name);
  const button=[...document.querySelectorAll("[data-download]")].find(x=>x.dataset.download===name);
  try{
    if(button)button.setAttribute("aria-busy","true");
    const response=await fetch(url,{mode:"cors"});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const blob=await response.blob();
    const objectURL=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=objectURL;
    a.download=nameOf(name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(objectURL),1000);
  }catch(err){
    // Archive.org may reject cross-origin blob downloads; open the exact file as a safe fallback.
    window.open(url,"_blank","noopener,noreferrer");
    console.warn("Direct download fallback:",err);
  }finally{
    if(button)button.removeAttribute("aria-busy");
  }
}

$("#heroPlay").onclick=()=>playVisible(0);
$("#heroFavorite").onclick=()=>{
  if(!currentCollection)return;
  const active=toggleFavorite("favoriteCollections",currentCollection.folder);
  $("#heroFavorite").classList.toggle("favorite-active",active);
  $("#heroFavorite svg").setAttribute("fill",active?"currentColor":"none");
};
$("#toggle").onclick=()=>{
  if(current<0){
    if(currentCollection)playVisible(0);
    else if(visibleTracks.length)playVisible(0);
    else if(collections[0])openCollection(collections[0].folder);
  }else if(audio.paused)audio.play().catch(()=>{$("#nowSub").textContent="Playback failed · try again"})
  else audio.pause();
};
$("#next").onclick=()=>move(1);
$("#prev").onclick=()=>move(-1);

$("#backToCollections").onclick=()=>{
  view="collections";
  currentCollection=null;
  visibleTracks=[];
  search.value="";
  shownCollections=PAGE_SIZE;
  renderCollections();
};

document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  view=b.dataset.view;
  currentCollection=null;
  visibleTracks=[];
  search.value="";
  shownCollections=PAGE_SIZE;
  if(view==="collections")renderCollections();
  else if(view==="favorites")renderFavorites();
  else renderRecent();
});

function renderRecent(){
  currentCollection=null;
  $("#backToCollections").classList.add("hidden");
  setCommonPage("Recently played","Recently played","Continue listening to audio you recently opened.","Search recent tracks...");
  $("#heroPlay").style.display="none";
  $("#heroFavorite").style.display="none";

  const recent=json("recent"),q=search.value.toLowerCase();
  const tracks=recent.map(n=>files.find(f=>f.name===n)).filter(Boolean).filter(f=>pretty(f.name).toLowerCase().includes(q));
  visibleTracks=tracks;

  $("#count").textContent=`${tracks.length} tracks`;
  content.className="playlist";
  const favSet=new Set(json("favoriteTracks"));
  content.innerHTML=tracks.length?tracks.map((f,i)=>`<div class="playlist-row ${files[current]?.name===f.name?"playing":""}">
  <div class="track-num">${i+1}</div><div><div class="track-title">${esc(pretty(f.name))}</div><div class="track-meta">${esc((f.format||"Audio").toUpperCase())}</div></div><div class="track-size">${fmtSize(f.size)}</div>
  <div class="track-actions"><button class="track-action ${favSet.has(f.name)?"favorite-active":""}" data-favorite-track="${esc(f.name)}" aria-label="Favorite"><svg viewBox="0 0 24 24" fill="${favSet.has(f.name)?"currentColor":"none"}"><path d="m12 19-7-5.2A4.4 4.4 0 0 1 10 6l2 2 2-2a4.4 4.4 0 0 1 5 7.8L12 19Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>
  <button class="track-action" data-download="${esc(f.name)}" aria-label="Download audio"><svg viewBox="0 0 24 24" fill="none"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  <button class="track-action track-play" data-track="${esc(f.name)}" aria-label="Play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.53.85l9.5-6.5a1 1 0 0 0 0-1.7l-9.5-6.5A1 1 0 0 0 8 5.5Z"/></svg></button></div></div>`).join(""):'<div class="empty">Nothing played yet.</div>';
}

function renderFavorites(){
  currentCollection=null;
  visibleTracks=[];
  $("#backToCollections").classList.add("hidden");
  setCommonPage("Favorites","Favorites","Your favorite collections and audio tracks.","Search favorites...");
  $("#heroPlay").style.display="none";
  $("#heroFavorite").style.display="none";

  const q=search.value.trim().toLowerCase();
  const fc=new Set(json("favoriteCollections"));
  const ft=new Set(json("favoriteTracks"));
  const cols=collections.filter(c=>fc.has(c.folder)&&pretty(c.folder).toLowerCase().includes(q));
  const tracks=files.filter(f=>ft.has(f.name)&&pretty(f.name).toLowerCase().includes(q));
  visibleTracks=tracks;

  $("#count").textContent=`${cols.length+tracks.length} favorites`;
  let html="";
  if(cols.length){
    html+=`<div class="favorites-heading">Collections</div><div class="collection-grid">`;
    html+=cols.map(c=>`<article class="collection-card" data-folder="${esc(c.folder)}"><div class="card-art"><img loading="lazy" src="${IMG}" alt="OSHO Talks"></div><div class="card-body"><div class="card-title">${esc(pretty(c.folder))}</div><div class="card-meta">${c.tracks.length} audio files</div><div class="card-actions"><button class="card-action favorite-active" data-favorite-collection="${esc(c.folder)}" aria-label="Favorite"><svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 19-7-5.2A4.4 4.4 0 0 1 10 6l2 2 2-2a4.4 4.4 0 0 1 5 7.8L12 19Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button></div></div></article>`).join("");
    html+="</div>";
  }
  if(tracks.length){
    html+=`<div class="favorites-heading">Audio</div><div class="playlist">`;
    html+=tracks.map((f,i)=>`<div class="playlist-row ${files[current]?.name===f.name?"playing":""}"><div class="track-num">${i+1}</div><div><div class="track-title">${esc(pretty(f.name))}</div><div class="track-meta">Favorite audio</div></div><div class="track-size">${fmtSize(f.size)}</div><div class="track-actions"><button class="track-action favorite-active" data-favorite-track="${esc(f.name)}" aria-label="Favorite"><svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 19-7-5.2A4.4 4.4 0 0 1 10 6l2 2 2-2a4.4 4.4 0 0 1 5 7.8L12 19Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button><button class="track-action" data-download="${esc(f.name)}" aria-label="Download audio"><svg viewBox="0 0 24 24" fill="none"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="track-action track-play" data-track="${esc(f.name)}" aria-label="Play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.53.85l9.5-6.5a1 1 0 0 0 0-1.7l-9.5-6.5A1 1 0 0 0 8 5.5Z"/></svg></button></div></div>`).join("");
    html+="</div>";
  }
  content.className="favorites-content";
  content.innerHTML=html||'<div class="empty">No favorites yet.</div>';
}

$("#search").oninput=()=>{
  if(view==="playlist")renderPlaylist();
  else if(view==="recent")renderRecent();
  else if(view==="favorites")renderFavorites();
  else {shownCollections=PAGE_SIZE;renderCollections()}
};

audio.onplay=()=>{
  $("#toggleIcon").innerHTML='<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>';
  if(view==="playlist")renderPlaylist();
  else if(view==="recent")renderRecent();
  else if(view==="favorites")renderFavorites();
};

audio.onpause=()=>{
  $("#toggleIcon").innerHTML='<path d="M8 5.5v13a1 1 0 0 1 1.53.85l9.5-6.5a1 1 0 0 0 0-1.7l-9.5-6.5A1 1 0 0 0 8 5.5Z"/>';
  if(view==="playlist")renderPlaylist();
  else if(view==="recent")renderRecent();
  else if(view==="favorites")renderFavorites();
};

audio.onerror=()=>{
  pendingPlay=null;
  $("#toggleIcon").innerHTML='<path d="M8 5.5v13a1 1 0 0 0 1.53.85l9.5-6.5a1 1 0 0 0 0-1.7l-9.5-6.5A1 1 0 0 0 8 5.5Z"/>';
  if($("#nowTitle").textContent!=="Nothing playing")$("#nowSub").textContent="Audio unavailable · try again";
  if(view==="playlist")renderPlaylist();
  else if(view==="recent")renderRecent();
  else if(view==="favorites")renderFavorites();
};

audio.ontimeupdate=()=>{
  if(current>=0&&files[current])localStorage.setItem("pos:"+files[current].name,audio.currentTime);
  $("#seek").value=audio.duration?audio.currentTime/audio.duration*100:0;
};
audio.onended=()=>move(1);
$("#seek").oninput=e=>{if(audio.duration)audio.currentTime=audio.duration*e.target.value/100};
$("#volume").oninput=e=>audio.volume=e.target.value;
const speeds=[1,1.25,1.5,1.75,2,.75,.5];
let speedIndex=0;
$("#speed").onclick=()=>{speedIndex=(speedIndex+1)%speeds.length;audio.playbackRate=speeds[speedIndex];$("#speed").textContent=speeds[speedIndex]+"×"};

async function fetchLibrary(){
  try{
    const response=await fetch(API,{cache:"no-cache"});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    const nextFiles=normalizeFiles(data.files||[]);
    if(!nextFiles.length)throw new Error("Archive.org returned no Hindi audio files");

    files=nextFiles;
    buildCollections();
    saveCache();

    // Preserve the user's current page/view after a background refresh.
    if(view==="collections")renderCollections();
    else if(view==="favorites")renderFavorites();
    else if(view==="recent")renderRecent();
    else if(view==="playlist"){
      const folder=currentCollection?.folder;
      currentCollection=folder?collections.find(c=>c.folder===folder)||null:null;
      if(currentCollection)renderPlaylist();
      else {view="collections";renderCollections()}
    }
  }catch(e){
    if(!files.length){
      content.innerHTML='<div class="empty">Could not load Archive.org metadata. Check your internet connection.</div>';
      $("#count").textContent="Unavailable";
    }else{
      console.warn("Archive.org metadata refresh failed; keeping cached library.",e);
    }
  }
}

// Render cached data immediately; update from Archive.org in the background.
if(loadCache())renderCollections();
else{
  content.innerHTML='<div class="loading-grid">'+Array.from({length:12},()=>'<div class="skeleton-card"></div>').join("")+'</div>';
  $("#count").textContent="Loading library…";
}
fetchLibrary();
