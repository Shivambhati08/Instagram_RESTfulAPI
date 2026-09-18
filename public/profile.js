const pendingProfileRequests = new Set();

function setProfileBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
}

async function profileRequest(key, url, options = {}) {
    if (pendingProfileRequests.has(key)) return null;
    pendingProfileRequests.add(key);
    try {
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Unable to update profile.");
        return data;
    } finally {
        pendingProfileRequests.delete(key);
    }
}

function showProfileError(message) {
    let status = document.querySelector(".profile-error");
    if (!status) {
        status = document.createElement("p");
        status.className = "profile-error form-message";
        document.querySelector(".profile-card").prepend(status);
    }
    status.textContent = message;
}

document.querySelectorAll(".stat-button").forEach((button) => {
    button.addEventListener("click", () => {
        const panel = document.getElementById(button.dataset.listTarget);
        if (!panel) return;
        const shouldOpen = panel.hidden;
        document.querySelectorAll(".connection-panel").forEach((item) => { item.hidden = true; });
        panel.hidden = !shouldOpen;
    });
});

document.querySelectorAll(".follow-button").forEach((button) => {
    button.addEventListener("click", async (event) => {
        event.preventDefault();
        const form = button.closest("form");
        setProfileBusy(button, true);
        try {
            const data = await profileRequest(`follow:${form.action}`, form.action, { method: "POST" });
            if (!data) return;
            button.textContent = data.followed ? "Following" : "Follow";
            const followers = document.querySelector("[data-followers-count]");
            if (followers) followers.textContent = data.followersCount;
        } catch (error) {
            showProfileError(error.message);
        } finally {
            setProfileBusy(button, false);
        }
    });
});
