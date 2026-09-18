const searchForm = document.querySelector(".user-search-form");
const searchButton = searchForm?.querySelector("button");
const searchLoading = document.querySelector(".discovery-loading");

searchForm?.addEventListener("submit", () => {
    if (searchButton) {
        searchButton.disabled = true;
        searchButton.textContent = "Searching...";
    }
    if (searchLoading) searchLoading.hidden = false;
});

document.querySelectorAll(".search-follow-form").forEach((form) => {
    const button = form.querySelector("button");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        button.disabled = true;
        try {
            const response = await fetch(form.action, { method: "POST" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || "Unable to update follow state.");
            button.textContent = data.followed ? "Following" : "Follow";
        } catch (error) {
            button.textContent = "Try again";
            button.title = error.message;
        } finally {
            button.disabled = false;
        }
    });
});
