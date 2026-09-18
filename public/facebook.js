document.querySelectorAll("[data-facebook-login]").forEach((link) => {
    link.addEventListener("click", () => {
        link.setAttribute("aria-busy", "true");
        const label = link.querySelector("span");
        if (label) label.textContent = "Connecting to Facebook...";
    });
});