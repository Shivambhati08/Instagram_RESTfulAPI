const body = document.querySelector("body");
const options = document.querySelectorAll(".optionsForU");
const dots = document.querySelectorAll(".three-dot");
const cancelLinks = document.querySelectorAll("#cancel");
const pendingRequests = new Set();

const feedSkeleton = document.querySelector(".feed-skeleton");
if (feedSkeleton) feedSkeleton.remove();

function showStatus(message, isError = true) {
    const status = document.querySelector(".feed-status");
    if (!status) return;

    status.textContent = message;
    status.classList.toggle("error", isError);
    status.classList.add("visible");
    window.clearTimeout(status.hideTimer);
    status.hideTimer = window.setTimeout(() => status.classList.remove("visible"), 4500);
}

async function requestOnce(key, url, requestOptions = {}) {
    if (pendingRequests.has(key)) return null;

    pendingRequests.add(key);
    try {
        const response = await fetch(url, requestOptions);
        let data = {};
        try {
            data = await response.json();
        } catch (error) {
            data = {};
        }

        if (!response.ok) {
            throw new Error(data.error || "Something went wrong. Please try again.");
        }

        return data;
    } finally {
        pendingRequests.delete(key);
    }
}

function setBusy(element, isBusy) {
    if (!element) return;
    element.disabled = isBusy;
    element.setAttribute("aria-busy", String(isBusy));
}

function closePostMenu() {
    options.forEach((option) => option.classList.add("invisible"));
    body.classList.remove("gradient");
    document.querySelectorAll("img").forEach((img) => img.classList.remove("brightness"));
}

function appendComment(form, data) {
    const postCard = form.closest(".post-card");
    const comments = postCard && postCard.querySelector(".comments-preview");
    if (!comments || !data.comment) return;

    const emptyMessage = comments.querySelector(".muted-text");
    if (emptyMessage) emptyMessage.remove();

    const comment = data.comment;
    const row = document.createElement("p");
    row.className = "comment-row";
    row.dataset.commentId = comment.id;
    const author = document.createElement("strong");
    author.textContent = comment.commenter.username;
    const text = document.createTextNode(` ${comment.text} `);
    const timestamp = document.createElement("time");
    timestamp.textContent = "Just now";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-comment";
    deleteButton.dataset.postId = postCard.dataset.postId;
    deleteButton.dataset.commentId = comment.id;
    deleteButton.textContent = "Delete";
    row.append(author, text, timestamp, document.createTextNode(" "), deleteButton);
    comments.prepend(row);
}

options.forEach((option) => option.classList.add("invisible"));
dots.forEach((dot) => {
    dot.addEventListener("click", () => {
        options.forEach((option) => option.classList.add("invisible"));
        body.classList.add("gradient");
        document.querySelectorAll("img").forEach((img) => img.classList.add("brightness"));
        const menu = dot.closest(".post-card")?.querySelector(".optionsForU");
        if (menu) menu.classList.remove("invisible");
    });
});

cancelLinks.forEach((cancel) => {
    cancel.addEventListener("click", (event) => {
        event.preventDefault();
        closePostMenu();
    });
});

document.querySelectorAll(".like-button").forEach((button) => {
    button.addEventListener("click", async (event) => {
        event.preventDefault();
        const form = button.closest("form");
        const postCard = form.closest(".post-card");
        const postId = postCard.dataset.postId;
        setBusy(button, true);

        try {
            const data = await requestOnce(`like:${postId}`, form.action, { method: "POST" });
            if (!data) return;

            postCard.querySelector(".like-count").textContent = `${data.likesCount} likes`;
            button.classList.toggle("liked", data.liked);
            button.setAttribute("aria-pressed", String(data.liked));
        } catch (error) {
            showStatus(error.message);
        } finally {
            setBusy(button, false);
        }
    });
});

document.querySelectorAll(".comment-form:not(#comment-form)").forEach((form) => {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const input = form.querySelector("input[name='text']");
        const text = input.value.trim();
        if (!text) return;

        const postCard = form.closest(".post-card");
        const postId = postCard.dataset.postId;
        const submit = form.querySelector("button");
        setBusy(submit, true);

        try {
            const data = await requestOnce(`comment:${postId}`, form.action, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
            });
            if (!data) return;
            input.value = "";
            appendComment(form, data);
        } catch (error) {
            showStatus(error.message);
        } finally {
            setBusy(submit, false);
        }
    });
});

document.querySelectorAll(".follow-button").forEach((button) => {
    button.addEventListener("click", async (event) => {
        event.preventDefault();
        const form = button.closest("form");
        setBusy(button, true);

        try {
            const data = await requestOnce(`follow:${form.action}`, form.action, { method: "POST" });
            if (data) button.textContent = data.followed ? "Following" : "Follow";
        } catch (error) {
            showStatus(error.message);
        } finally {
            setBusy(button, false);
        }
    });
});

document.querySelectorAll(".share-post-button").forEach((button) => {
    button.addEventListener("click", async () => {
        const url = new URL(button.dataset.shareUrl, window.location.origin).href;
        try {
            if (navigator.share) {
                await navigator.share({ title: "Instagram post", url });
            } else {
                await navigator.clipboard.writeText(url);
                showStatus("Post link copied.", false);
            }
        } catch (error) {
            if (error.name !== "AbortError") showStatus("Unable to share this post.");
        }
    });
});

document.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest(".delete-comment");
    if (!deleteButton) return;

    event.preventDefault();
    const { postId, commentId } = deleteButton.dataset;
    setBusy(deleteButton, true);

    try {
        const data = await requestOnce(`delete-comment:${postId}:${commentId}`, `/api/posts/${postId}/comments/${commentId}`, {
            method: "DELETE",
            headers: { Accept: "application/json" },
        });
        if (!data) return;
        document.querySelectorAll(`[data-comment-id="${commentId}"]`).forEach((comment) => comment.remove());
        showStatus("Comment deleted.", false);
    } catch (error) {
        showStatus(error.message);
        setBusy(deleteButton, false);
    }
});

document.querySelectorAll("[data-delete-post-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const postCard = form.closest(".post-card");
        const postId = postCard.dataset.postId;
        const deleteButton = form.querySelector("button");
        setBusy(deleteButton, true);

        try {
            const data = await requestOnce(`delete-post:${postId}`, `/home/${postId}`, {
                method: "DELETE",
                headers: { Accept: "application/json" },
            });
            if (!data) return;
            postCard.remove();
            closePostMenu();
            showStatus("Post deleted.", false);
            if (!document.querySelector(".post-card")) window.location.reload();
        } catch (error) {
            showStatus(error.message);
            setBusy(deleteButton, false);
        }
    });
});

const likeButtonDetail = document.querySelector(".like-button-detail");
if (likeButtonDetail) {
    likeButtonDetail.addEventListener("click", async () => {
        const postId = likeButtonDetail.dataset.postId;
        setBusy(likeButtonDetail, true);
        try {
            const data = await requestOnce(`like:${postId}`, `/api/posts/${postId}/like`, { method: "POST" });
            if (!data) return;
            document.querySelector(".likes-line").textContent = `${data.likesCount} likes`;
            likeButtonDetail.classList.toggle("liked", data.liked);
        } catch (error) {
            showStatus(error.message);
        } finally {
            setBusy(likeButtonDetail, false);
        }
    });
}

const detailCommentForm = document.querySelector("#comment-form");
if (detailCommentForm) {
    detailCommentForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const input = detailCommentForm.querySelector("input[name='text']");
        const text = input.value.trim();
        if (!text) return;

        const postId = detailCommentForm.action.split("/").slice(-2)[0];
        const submit = detailCommentForm.querySelector("button");
        setBusy(submit, true);
        try {
            const data = await requestOnce(`comment:${postId}`, detailCommentForm.action, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
            });
            if (!data) return;
            input.value = "";
            showStatus("Comment added.", false);
            window.setTimeout(() => window.location.reload(), 250);
        } catch (error) {
            showStatus(error.message);
        } finally {
            setBusy(submit, false);
        }
    });
}
