// feed.js - realtime posts & upload (no UI change)
// Prereqs: firebase initialized, global db & currentUid from index.html

/////////////////////// UI HOOKUP ///////////////////////

function loadPostsUIStyles() {
  if (document.head.querySelector('[data-posts-ui-styles]')) return;
  fetch('posts_ui.html').then(r => r.text()).then(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => {
      const clone = el.cloneNode(true);
      // If it's an inline <style> tag, strip any global rules that could clash
      if (clone.tagName === 'STYLE') {
        let css = clone.textContent || '';
        // Remove rules targeting body / html or the generic .container class
        css = css.replace(/(?:html,\s*)?body\s*\{[\s\S]*?\}/g, '');
        css = css.replace(/\.container\s*\{[\s\S]*?\}/g, '');
        // Skip injection if nothing remains
        if (!css.trim()) return;
        clone.textContent = css;
      }
      clone.setAttribute('data-posts-ui-styles', '');
      document.head.appendChild(clone);
    });
  }).catch(console.error);
}

document.addEventListener('DOMContentLoaded', () => {
  loadPostsUIStyles();
  makeHiddenFileInput();
  setupPreviewClick();
  initFeedListener();
});

function makeHiddenFileInput() {
  if (document.getElementById('post-file')) return;
  const input = Object.assign(document.createElement('input'), {
    type: 'file', id: 'post-file', accept: 'image/*,video/*', style: 'display:none'
  });
  input.onchange = onFileChosen;
  document.body.appendChild(input);
}

function setupPreviewClick() {
  const preview = document.getElementById('media-preview');
  if (preview) preview.addEventListener('click', () => document.getElementById('post-file').click());
}

/////////////////////// FILE SELECTION ///////////////////////

let selFile = null; // Blob
let selType = '';

async function onFileChosen(e) {
  const f = e.target.files[0];
  if (!f) return;
  if (f.type.startsWith('image')) {
    selType = 'image';
    selFile = await autoCrop(f);
  } else if (f.type.startsWith('video')) {
    selType = 'video';
    selFile = f;
  } else {
    alert('Unsupported type');
    return;
  }
  showPreview(URL.createObjectURL(selFile), selType);
}

function autoCrop(file) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const landscape = img.width >= img.height; // choose 4:3 or 3:4
      const tr = landscape ? 4 / 3 : 3 / 4;
      let cw = img.width, ch = img.height;
      if (landscape) ch = cw / tr; else cw = ch / tr;
      if (ch > img.height) { ch = img.height; cw = ch * tr; }
      if (cw > img.width) { cw = img.width; ch = cw / tr; }
      const sx = (img.width - cw) / 2, sy = (img.height - ch) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      canvas.getContext('2d').drawImage(img, sx, sy, cw, ch, 0, 0, cw, ch);
      canvas.toBlob(b => res(b), 'image/jpeg', 0.9);
    };
    img.src = URL.createObjectURL(file);
  });
}

function showPreview(url, type) {
  const preview = document.getElementById('media-preview');
  if (!preview) return;
  preview.style.display = 'block';
  preview.innerHTML = '';
  if (type === 'video') {
    const v = document.createElement('video');
    v.src = url; v.controls = true; v.style.width = '100%'; v.style.height = '100%';
    preview.appendChild(v);
  } else {
    const img = document.createElement('img');
    img.src = url; img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'cover';
    preview.appendChild(img);
  }
}

/////////////////////// POST SUBMIT ///////////////////////

async function submitPost() {
  const capInput = document.getElementById('post-text');
  if (!capInput) return;
  const caption = capInput.value.trim();
  if (!caption && !selFile) { alert('Add caption or media'); return; }
  if (!currentUid) { alert('Not signed in'); return; }
  try {
    let mediaURL = '', mediaType = '';
    if (selFile) {
      mediaType = selType;
      const ref = firebase.storage().ref().child(`posts/${currentUid}/${Date.now()}`);
      const snap = await ref.put(selFile);
      mediaURL = await snap.ref.getDownloadURL();
    }
    // Determine username & avatar
    let usernameField = 'User';
    let avatarField = '';
    const authUser = firebase.auth().currentUser;
    if (authUser) {
      usernameField = authUser.displayName || usernameField;
      avatarField = authUser.photoURL || avatarField;
    }
    // If still missing, pull from profiles collection
    if (!avatarField || usernameField === 'User') {
      try {
        const prof = await db.collection('profiles').doc(currentUid).get();
        if (prof.exists) {
          const pdata = prof.data();
          usernameField = pdata.fullName || pdata.name || pdata.username || pdata.displayName || usernameField;
          avatarField = pdata.profilePhotoURL || pdata.photoURL || avatarField;
        }
      } catch {}
    }

    await db.collection('posts').add({
      uid: currentUid,
      username: usernameField,
      avatarURL: avatarField,
      caption,
      mediaURL,
      mediaType,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      likes: 0,
      likedBy: []
    });
    // reset UI
    capInput.value = '';
    selFile = null; selType = '';
    const preview = document.getElementById('media-preview');
    if (preview) preview.style.display = 'none';
    closeModal('create-post-modal');
  } catch (err) {
    console.error('post upload err', err);
    alert('Failed to post');
  }
}

/////////////////////// FEED LISTENER ///////////////////////

function initFeedListener() {
  const container = document.getElementById('feed-container');
  if (!container) return;
  db.collection('posts').orderBy('timestamp', 'desc').onSnapshot(async snap => {
    container.innerHTML = '';
    for (const doc of snap.docs) {
      await renderPost(container, doc);
    }
  });
}

async function renderPost(container, doc) {
  const data = doc.data();
  // Prefer stored fields if present
  let username = data.username || 'User';
  let avatarURL = data.avatarURL || '';
  // Fallback to profile lookup if missing
  if (!avatarURL || username === 'User') {
    try {
      const pSnap = await db.collection('profiles').doc(data.uid).get();
      if (pSnap.exists) {
        const pd = pSnap.data();
        username = pd.fullName || pd.name || pd.username || pd.displayName || username;
        avatarURL = pd.profilePhotoURL || pd.photoURL || avatarURL;
      }
    } catch {}
  }
  const timeStr = data.timestamp ? _fmtTime(data.timestamp.toDate()) : 'Just now';

  const postEl = document.createElement('div');
  postEl.className = 'post-container glass';
  postEl.innerHTML = `
    <div class="post-header">
      <div class="avatar">${avatarURL ? `<img src="${avatarURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : '<i class="fas fa-user"></i>'}</div>
      <div class="user-info"><div class="username">${username}</div><div class="time">${timeStr}</div></div>
      <i class="fas fa-ellipsis-v"></i>
    </div>
    ${data.caption ? `<div class="post-caption"><span class="post-caption-username">${username}</span> ${data.caption}</div>` : ''}
    ${renderMediaHTML(data)}
    <div class="post-actions">
      <div class="post-action" onclick="toggleLike(this)" data-id="${doc.id}">
        <i class="${data.likedBy?.includes(currentUid) ? 'fas' : 'far'} fa-heart"></i>
        <span class="post-action-count">${data.likes || 0}</span>
      </div>
      <div class="post-action" onclick="alert('Comments feature coming soon!')">
        <i class="far fa-comment"></i>
        <span class="post-action-count">0</span>
      </div>
      <div class="post-action"><i class="far fa-paper-plane"></i></div>
      <div class="post-action-spacer"></div>
      <div class="post-action"><i class="far fa-bookmark"></i></div>
    </div>
    <div class="post-stats"><div class="post-likes">${data.likes || 0} likes</div><div class="post-timestamp">${timeStr}</div></div>
  `;
  container.appendChild(postEl);
}

function renderMediaHTML(d) {
  if (!d.mediaURL) return '';
  if (d.mediaType === 'video') {
    return `<video src="${d.mediaURL}" style="width:100%;height:333px;aspect-ratio:3/4;object-fit:cover;" controls></video>`;
  }
  // Always force portrait 3:4 (w:h) for images
  return `<img class="post-media" src="${d.mediaURL}" style="width:100%;height:100%;object-fit:cover;">`;
}
