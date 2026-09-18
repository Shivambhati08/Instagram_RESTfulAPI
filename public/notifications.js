const notificationStatus = document.querySelector(".notification-status");
const pendingNotificationRequests = new Set();

function setNotificationBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
}

function showNotificationError(message) {
    if (!notificationStatus) return;
    notificationStatus.textContent = message;
    notificationStatus.classList.add("visible");
}

async function markNotificationRead(id) {
    if (pendingNotificationRequests.has(id)) return null;
    pendingNotificationRequests.add(id);
    try {
        const response = await fetch(`/api/notifications/${id}/read`, {
            method: "PATCH",
            headers: { Accept: "application/json" },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Unable to mark notification as read.");
        return data;
    } finally {
        pendingNotificationRequests.delete(id);
    }
}

function updateUnreadCount(count) {
    const counter = document.querySelector("[data-unread-count]");
    if (counter) counter.textContent = count;
}

document.querySelectorAll(".mark-read-button").forEach((button) => {
    button.addEventListener("click", async () => {
        const id = button.dataset.notificationId;
        setNotificationBusy(button, true);
        try {
            const data = await markNotificationRead(id);
            if (!data) return;
            const item = document.querySelector(`[data-notification-id="${id}"]`);
            if (item) {
                item.classList.remove("unread");
                button.remove();
            }
            updateUnreadCount(data.unreadCount);
        } catch (error) {
            showNotificationError(error.message);
            setNotificationBusy(button, false);
        }
    });
});

document.querySelector(".read-all-button")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setNotificationBusy(button, true);
    try {
        const response = await fetch("/api/notifications/read-all", {
            method: "POST",
            headers: { Accept: "application/json" },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Unable to mark notifications as read.");
        document.querySelectorAll(".notification-item.unread").forEach((item) => item.classList.remove("unread"));
        document.querySelectorAll(".mark-read-button").forEach((item) => item.remove());
        updateUnreadCount(data.unreadCount);
        button.remove();
    } catch (error) {
        showNotificationError(error.message);
        setNotificationBusy(button, false);
    }
});
