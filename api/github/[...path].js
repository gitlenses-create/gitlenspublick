module.exports = async function handler(req, res) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        res.status(500).json({ message: "GitHub token not configured" });
        return;
    }

    try {
        const segments = req.query.path;
        const path = Array.isArray(segments) ? segments.join("/") : (segments || "");
        const url = new URL(req.url, `http://${req.headers.host}`);
        const ghUrl = `https://api.github.com/${path}${url.search}`;

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
