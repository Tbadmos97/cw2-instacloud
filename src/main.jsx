import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const STAR_VALUES = [1, 2, 3, 4, 5];

function jsonHeaders() {
  return { 'Content-Type': 'application/json' };
}

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const demoRole = localStorage.getItem('instacloudRole');
  if (demoRole) headers['x-demo-role'] = demoRole;

  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    const message = data?.error || data?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function AuthButtons() {
  const demoLogin = (role) => {
    localStorage.setItem('instacloudRole', role);
    window.location.href = '/';
  };

  return (
    <div className="login-panel">
      <h2>Sign in to InstaCloud</h2>
      <p>Choose a coursework demo role. Consumer accounts can browse, search, comment and rate. Creator accounts can also upload photos.</p>
      <div className="login-actions">
        <button className="primary-button" onClick={() => demoLogin('creator')}>Login as Creator</button>
        <button className="secondary-button" onClick={() => demoLogin('viewer')}>Login as Consumer</button>
      </div>
    </div>
  );
}

function Header({ user, currentPage, setCurrentPage }) {
  const isCreator = user?.roles?.includes('creator');

  return (
    <header className="topbar">
      <div className="brand" onClick={() => setCurrentPage('feed')} role="button" tabIndex="0">
        <div className="logo-mark">◎</div>
        <div>
          <h1>InstaCloud</h1>
          <p>Azure photo sharing mini project</p>
        </div>
      </div>
      <nav className="nav-tabs" aria-label="Main navigation">
        <button className={currentPage === 'feed' ? 'active' : ''} onClick={() => setCurrentPage('feed')}>Viewer feed</button>
        <button className={currentPage === 'creator' ? 'active' : ''} onClick={() => setCurrentPage('creator')}>Creator studio</button>
      </nav>
      <div className="user-chip">
        {user ? (
          <>
            <span className="avatar">{(user.displayName || 'U').slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{user.displayName || 'Signed-in user'}</strong>
              <small>{isCreator ? 'Creator + Viewer' : 'Viewer only'}</small>
            </span>
            <a className="logout" href="/" onClick={() => localStorage.removeItem('instacloudRole')}>Logout</a>
          </>
        ) : <a className="primary-button compact" href="/.auth/login/github">Login</a>}
      </div>
    </header>
  );
}

function Feed({ posts, onSearch, search, loading, refresh, onRate, onComment }) {
  return (
    <main className="layout">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Consumer view</p>
          <h2>Explore Azure-hosted photos</h2>
          <p>Search image metadata, view posts, add comments and rate content. Viewer accounts cannot upload.</p>
        </div>
        <button className="secondary-button" onClick={refresh}>Refresh</button>
      </section>

      <section className="search-card">
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search by title, caption, location or people..."
          aria-label="Search photos"
        />
      </section>

      {loading ? <div className="empty-card">Loading Azure content...</div> : null}
      {!loading && posts.length === 0 ? <div className="empty-card">No posts yet. Upload as creator, then return to the viewer feed.</div> : null}

      <section className="post-grid">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} onRate={onRate} onComment={onComment} />
        ))}
      </section>
    </main>
  );
}

function PostCard({ post, onRate, onComment }) {
  const [commentText, setCommentText] = useState('');
  const [working, setWorking] = useState(false);

  const submitComment = async (event) => {
    event.preventDefault();
    if (!commentText.trim()) return;
    setWorking(true);
    try {
      await onComment(post.id, commentText.trim());
      setCommentText('');
    } finally {
      setWorking(false);
    }
  };

  return (
    <article className="post-card">
      <img src={post.imageUrl} alt={post.title || 'Uploaded photo'} className="post-image" />
      <div className="post-body">
        <div className="post-header">
          <div>
            <h3>{post.title}</h3>
            <span className="muted">by {post.createdByName || 'creator'}</span>
          </div>
          <span className="pill">{post.location || 'No location'}</span>
        </div>
        <p>{post.caption}</p>
        {post.people ? <p className="people">People: {post.people}</p> : null}
        <div className="rating-row">
          <span>Rating: <strong>{Number(post.avgRating || 0).toFixed(1)}</strong> ({post.ratingCount || 0})</span>
          <div className="stars" aria-label="Rate photo">
            {STAR_VALUES.map((value) => (
              <button key={value} onClick={() => onRate(post.id, value)} title={`Rate ${value} stars`}>
                {value <= Math.round(post.myRating || post.avgRating || 0) ? '★' : '☆'}
              </button>
            ))}
          </div>
        </div>
        <div className="comments">
          <h4>Comments</h4>
          {(post.comments || []).slice(-3).map((comment) => (
            <p key={comment.id}><strong>{comment.authorName || 'Viewer'}:</strong> {comment.text}</p>
          ))}
          {(post.comments || []).length === 0 ? <p className="muted">No comments yet.</p> : null}
        </div>
        <form className="comment-form" onSubmit={submitComment}>
          <input value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Add a comment..." />
          <button disabled={working}>{working ? 'Posting...' : 'Post'}</button>
        </form>
      </div>
    </article>
  );
}

function CreatorStudio({ user, refresh }) {
  const isCreator = user?.roles?.includes('creator');
  const [form, setForm] = useState({ title: '', caption: '', location: '', people: '' });
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value });

  const upload = async (event) => {
    event.preventDefault();
    setStatus('');
    if (!isCreator) {
      setStatus('Your account is viewer-only. Ask the Azure Static Web Apps owner to invite this login with the creator role.');
      return;
    }
    if (!file) {
      setStatus('Choose a photo first.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setStatus('Only image files are accepted for this photo-sharing project.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setStatus('Please choose an image smaller than 5 MB for the free-tier demo.');
      return;
    }

    setBusy(true);
    try {
      const imageDataUrl = await toBase64(file);
      await apiFetch('/api/upload', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ ...form, fileName: file.name, contentType: file.type, imageDataUrl })
      });
      setForm({ title: '', caption: '', location: '', people: '' });
      setFile(null);
      event.target.reset();
      setStatus('Upload complete. The file is in Azure Blob Storage and metadata is in Cosmos DB.');
      await refresh();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="layout narrow">
      <section className="hero-card creator-hero">
        <div>
          <p className="eyebrow">Creator view</p>
          <h2>Upload photo content</h2>
          <p>Creator accounts can add title, caption, location and people metadata. Viewer-only accounts are blocked by Azure role checks.</p>
        </div>
        <span className={isCreator ? 'role-ok' : 'role-no'}>{isCreator ? 'Creator role active' : 'Viewer-only account'}</span>
      </section>

      <form className="upload-form" onSubmit={upload}>
        <label>
          Photo file
          <input type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0] || null)} />
        </label>
        <label>
          Title
          <input value={form.title} onChange={update('title')} placeholder="Example: Belfast sunset" required />
        </label>
        <label>
          Caption
          <textarea value={form.caption} onChange={update('caption')} placeholder="Write a short caption..." required />
        </label>
        <div className="two-col">
          <label>
            Location
            <input value={form.location} onChange={update('location')} placeholder="Belfast" />
          </label>
          <label>
            People present
            <input value={form.people} onChange={update('people')} placeholder="Aisha, Sam" />
          </label>
        </div>
        <button className="primary-button" disabled={busy}>{busy ? 'Uploading to Azure...' : 'Upload to Azure'}</button>
        {status ? <p className="status-message">{status}</p> : null}
      </form>
    </main>
  );
}

function LoginPage() {
  return (
    <main className="layout narrow">
      <AuthButtons />
    </main>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [posts, setPosts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(() => window.location.pathname === '/creator' ? 'creator' : 'feed');

  const isLoginRoute = useMemo(() => window.location.pathname === '/login', []);

  const loadUser = async () => {
    try {
      const me = await apiFetch('/api/me');
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setAuthChecked(true);
    }
  };

  const loadPosts = async (term = search) => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const result = await apiFetch(`/api/posts?q=${encodeURIComponent(term)}`);
      setPosts(result.posts || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUser(); }, []);
  useEffect(() => { if (user) loadPosts(''); }, [user]);

  const onSearch = async (term) => {
    setSearch(term);
    await loadPosts(term);
  };

  const onRate = async (postId, rating) => {
    await apiFetch('/api/ratings', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ postId, rating })
    });
    await loadPosts(search);
  };

  const onComment = async (postId, text) => {
    await apiFetch('/api/comments', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ postId, text })
    });
    await loadPosts(search);
  };

  if (!authChecked) return <div className="loading-screen">Opening InstaCloud...</div>;
  if (isLoginRoute || !user) return <LoginPage />;

  return (
    <>
      <Header user={user} currentPage={currentPage} setCurrentPage={(page) => {
        setCurrentPage(page);
        window.history.pushState({}, '', page === 'creator' ? '/creator' : '/');
      }} />
      {error ? <div className="global-error">{error}</div> : null}
      {currentPage === 'creator' ? (
        <CreatorStudio user={user} refresh={() => loadPosts(search)} />
      ) : (
        <Feed posts={posts} onSearch={onSearch} search={search} loading={loading} refresh={() => loadPosts(search)} onRate={onRate} onComment={onComment} />
      )}
      <footer className="footer">React + Node.js on Azure App Service + Blob Storage + Cosmos DB</footer>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
