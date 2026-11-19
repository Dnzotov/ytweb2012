// SPDX-License-Identifier: GPL-3.0-or-later
// Demo data standing in for the (shut down) YouTube GData v2 API. Replace with a real backend later.
(function () {
  const clips = [{ src: 'media/v1.mp4', thumb: 'media/t1.jpg', dur: 45 }, { src: 'media/v2.mp4', thumb: 'media/t2.jpg', dur: 45 }, { src: 'media/v3.mp4', thumb: 'media/t3.jpg', dur: 45 }];
  const T = [
    ['Big Buck Bunny', 'blender', 596, 2419017, 'A large and lovable rabbit deals with three tiny bullies.'],
    ['Android 4.0: Ice Cream Sandwich', 'Android', 192, 1200455, 'Introducing the next version of Android.'],
    ['Nexus S: Official Demo', 'Google', 108, 884031, 'The Nexus S, the pure Google phone.'],
    ['Sintel (Blender Foundation)', 'blender', 888, 3552910, 'A lonely young woman searches for a baby dragon.'],
    ['The Making of Honeycomb', 'AndroidDevelopers', 320, 421877, 'Behind the scenes of Android 3.0.'],
    ['Google Chrome: Speed Tests', 'GoogleChrome', 123, 2090114, 'How fast is the web, really?'],
    ['Nyan Cat [original]', 'saraj00n', 217, 98341220, 'Nyan nyan nyan nyan nyan.'],
    ['Charlie bit my finger - again !', 'HDCYT', 56, 405318290, 'Charlie is very cute.'],
    ['Evolution of Dance', 'judsonlaipply', 360, 143219003, 'The most-viewed dance video of 2006.'],
    ['Keyboard Cat', 'CharlieSchmidt', 54, 25011722, 'Play him off, Keyboard Cat.'],
    ['Double Rainbow', 'HungryBear9562', 213, 39200221, 'What does this mean?'],
    ['Old Spice: The Man Your Man Could Smell Like', 'OldSpice', 33, 46010872, 'Look at your man, now back to me.'],
  ].map((t, i) => ({ id: 'v' + i, title: t[0], author: t[1], dur: t[2], views: t[3], desc: t[4], clip: clips[i % 3],
    likes: 1000 + i * 731, dislikes: 12 + i * 5, date: 'Mar ' + (3 + i) + ', 2011', category: ['Film & Animation', 'Science & Technology', 'Entertainment', 'Music', 'Comedy'][i % 5], tags: 'demo, video, ' + t[1] }));
  const comments = [['alex_m', 'Great video, thanks for sharing!', '2 hours ago'], ['droidfan', 'First!', '5 hours ago'], ['maria22', 'Can you make more like this?', '1 day ago'],
    ['kevin_s', 'Watched this three times already :)', '2 days ago'], ['tester', 'Nice quality for a phone.', '1 week ago'], ['anon_viewer', 'Subscribed.', '2 weeks ago']].map(c => ({ author: c[0], text: c[1], time: c[2] }));
  const me = { name: 'DemoUser', views: 12840, uploaded: 6, subscribers: 314, avatar: null,
    uploads: T.slice(0, 4), favorites: T.slice(4, 8), playlists: ['Watch later', 'Music', 'Android demos'], subscriptions: ['blender', 'Android', 'GoogleChrome', 'AndroidDevelopers'] };
  const categories = ['Autos & Vehicles', 'Comedy', 'Education', 'Entertainment', 'Film & Animation', 'Gaming', 'How-to & Style', 'Music', 'News & Politics', 'Nonprofits & Activism', 'People & Blogs', 'Pets & Animals', 'Science & Technology', 'Sports', 'Travel & Events'];
  const fmt = n => n.toLocaleString('en-US');
  const dur = s => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  window.DATA = { videos: T, comments, me, categories, fmt, dur };
})();
