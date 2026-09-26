// 日记与随笔详情页共用的 Supabase 点赞、评论功能。
window.initInteractions = async function (contentType, contentId) {
    const panel = document.getElementById('interaction-panel');
    panel.hidden = false;
    const message = document.getElementById('interaction-message');
    const showMessage = (text, error = false) => {
        message.textContent = text;
        message.style.color = error ? '#b42335' : '';
    };
    let toast = document.getElementById('action-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'action-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.style.cssText = 'position:fixed;left:50%;bottom:28px;z-index:9999;transform:translate(-50%, 12px);padding:11px 22px;border-radius:8px;background:rgba(25,25,25,.94);color:#fff;font-size:15px;box-shadow:0 4px 16px rgba(0,0,0,.2);opacity:0;visibility:hidden;transition:opacity .35s ease, transform .35s ease, visibility .35s;pointer-events:none;';
        document.body.append(toast);
    }
    let toastTimer;
    const showToast = text => {
        clearTimeout(toastTimer);
        toast.textContent = text;
        toast.style.visibility = 'visible';
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translate(-50%, 0)';
        });
        toastTimer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translate(-50%, 12px)';
            toastTimer = setTimeout(() => { toast.style.visibility = 'hidden'; }, 350);
        }, 1500);
    };
    const config = window.SUPABASE_CONFIG;
    const configured = config && config.SUPABASE_URL.startsWith('https://')
        && !config.SUPABASE_URL.includes('你的项目编号')
        && config.SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')
        && !config.SUPABASE_PUBLISHABLE_KEY.includes('在这里填写');
    if (!configured) {
        showMessage('请先在项目根目录的 supabase-config.js 中配置 Supabase URL 和 Publishable key。');
        document.getElementById('like-button').disabled = true;
        document.querySelector('#comment-form button').disabled = true;
        return;
    }

    try {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        const db = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY);
        const visitorKey = 'blog-visitor-id';
        let visitorId = localStorage.getItem(visitorKey);
        if (!visitorId) {
            visitorId = crypto.randomUUID();
            localStorage.setItem(visitorKey, visitorId);
        }
        const likeButton = document.getElementById('like-button');
        const likeCount = document.getElementById('like-count');
        const commentList = document.getElementById('comment-list');

        async function refreshLikes() {
            const { count, error } = await db.from('content_likes').select('*', { count: 'exact', head: true })
                .eq('content_type', contentType).eq('content_id', String(contentId));
            if (error) throw error;
            likeCount.textContent = count || 0;
            const { data: mine, error: mineError } = await db.from('content_likes').select('content_id')
                .eq('content_type', contentType).eq('content_id', String(contentId)).eq('visitor_id', visitorId).maybeSingle();
            if (mineError) throw mineError;
            likeButton.dataset.liked = mine ? 'true' : 'false';
            likeButton.firstChild.textContent = mine ? '♥ 已点赞（' : '♡ 点赞（';
        }

        async function refreshComments() {
            const { data, error } = await db.from('content_comments').select('nickname, content, created_at')
                .eq('content_type', contentType).eq('content_id', String(contentId)).order('created_at', { ascending: false });
            if (error) throw error;
            commentList.replaceChildren();
            if (!data || data.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'interaction-message';
                empty.textContent = '还没有评论，来发表第一条评论吧。';
                commentList.append(empty);
                return;
            }
            data.forEach(comment => {
                const card = document.createElement('article');
                card.className = 'comment-item';
                const meta = document.createElement('div');
                meta.className = 'comment-meta';
                const nickname = document.createElement('strong');
                nickname.textContent = comment.nickname;
                const date = document.createElement('time');
                date.textContent = new Date(comment.created_at).toLocaleString();
                meta.append(nickname, date);
                const content = document.createElement('p');
                content.className = 'comment-text';
                content.textContent = comment.content;
                card.append(meta, content);
                commentList.append(card);
            });
        }

        await Promise.all([refreshLikes(), refreshComments()]);
        const submitButton = document.querySelector('#comment-form button[type="submit"]');
        const cooldownKey = `comment-cooldown:${visitorId}`;
        let cooldownUntil = Number(localStorage.getItem(cooldownKey)) || 0;
        let cooldownTimer;
        function updateCooldown() {
            const secondsLeft = Math.ceil((cooldownUntil - Date.now()) / 1000);
            if (secondsLeft > 0) {
                submitButton.disabled = true;
                submitButton.textContent = `请等待 ${secondsLeft} 秒后再评论`;
                cooldownTimer = setTimeout(updateCooldown, 250);
            } else {
                submitButton.disabled = false;
                submitButton.textContent = '发表评论';
                localStorage.removeItem(cooldownKey);
            }
        }
        updateCooldown();

        likeButton.addEventListener('click', async () => {
            const wasLiked = likeButton.dataset.liked === 'true';
            likeButton.disabled = true;
            try {
                const request = db.from('content_likes');
                const { error } = wasLiked
                    ? await request.delete().eq('content_type', contentType).eq('content_id', String(contentId)).eq('visitor_id', visitorId)
                    : await request.insert({ content_type: contentType, content_id: String(contentId), visitor_id: visitorId });
                if (error) throw error;
                await refreshLikes();
                showToast(likeButton.dataset.liked === 'true' ? '点赞成功' : '已取消点赞');
            } catch (error) { showMessage('点赞操作失败：' + error.message, true); }
            finally { likeButton.disabled = false; }
        });

        document.getElementById('comment-form').addEventListener('submit', async event => {
            event.preventDefault();
            const nickname = document.getElementById('comment-nickname').value.trim();
            const content = document.getElementById('comment-content').value.trim();
            if (!nickname || !content) { showMessage('请填写昵称和评论内容。', true); return; }
            if (Date.now() < cooldownUntil) { updateCooldown(); return; }
            const submit = event.currentTarget.querySelector('button[type="submit"]');
            submit.disabled = true;
            try {
                const { error } = await db.from('content_comments').insert({ content_type: contentType, content_id: String(contentId), visitor_id: visitorId, nickname, content });
                if (error) throw error;
                document.getElementById('comment-content').value = '';
                await refreshComments();
                cooldownUntil = Date.now() + 10000;
                localStorage.setItem(cooldownKey, String(cooldownUntil));
                updateCooldown();
                showToast('评论成功');
            } catch (error) {
                showMessage(error.message.includes('10 seconds') || error.message.includes('10 秒')
                    ? '评论间隔为 10 秒，请稍后再试。'
                    : '评论发布失败：' + error.message, true);
                updateCooldown();
            }
        });
    } catch (error) {
        showMessage('加载互动内容失败：' + error.message, true);
    }
};
