module.exports = async function handler(req, res) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        res.status(500).json({ message: "GitHub token not configured" });
        return;
    }

    try {
        const url = new URL(req.url, `http://${req.headers.host}`);

        // Rewritten requests pass the GitHub path as ?path=users/login
        let ghPath = url.searchParams.get("path") || "";
        url.searchParams.delete("path");

        if (!ghPath) {
            ghPath = url.pathname.replace(/^\/api\/github\/?/, "");
        }

        ghPath = ghPath.replace(/^\/+/, "");
        const query = url.searchParams.toString();
        const ghUrl = `https://api.github.com/${ghPath}${query ? `?${query}` : ""}`;

        const ghResponse = await fetch(ghUrl, {
            method: req.method,
            headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "User-Agent": "GitLens-Proxy",
            },
        });

        for (const header of ["x-ratelimit-remaining", "x-ratelimit-reset", "x-ratelimit-limit", "link"]) {
            const value = ghResponse.headers.get(header);
            if (value) {
                res.setHeader(header, value);
            }
        }

        const body = await ghResponse.text();
        const contentType = ghResponse.headers.get("content-type") || "application/json";
        res.status(ghResponse.status).setHeader("Content-Type", contentType).send(body);
    } catch (error) {
        res.status(500).json({ message: "GitHub proxy error" });
    }
};
