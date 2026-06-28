/*
 * GitLens — client-side GitHub data aggregation.
 * Uses Vercel proxy when available, falls back to direct GitHub API.
 */
(function () {
    const DIRECT_API = "https://api.github.com";
    const TOKEN_KEY = "gitlens-token";

    function usesServerProxy() {
        const host = window.location.hostname;
        return host !== "localhost" && host !== "127.0.0.1";
    }

    window.GitLensRate = window.GitLensRate || {requestsLeft: null};

    function getToken() {
        try {
            return window.Cookies && Cookies.get(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || "";
        } catch (e) {
            return "";
        }
    }

    function setToken(token) {
        try {
            if (token) {
                localStorage.setItem(TOKEN_KEY, token);
            } else {
                localStorage.removeItem(TOKEN_KEY);
            }
        } catch (e) {}
    }

    function directClient() {
        const headers = {Accept: "application/vnd.github+json"};
        const token = getToken();
        if (token) {
            headers.Authorization = "token " + token;
        }
        return axios.create({baseURL: DIRECT_API, headers: headers});
    }

    function proxyClient() {
        const instance = axios.create({
            baseURL: "/api/github",
            headers: {Accept: "application/vnd.github+json"},
        });
        instance.interceptors.request.use(config => {
            const path = (config.url || "").replace(/^\//, "");
            const params = {...(config.params || {})};
            config.url = "";
            config.params = {path, ...params};
            return config;
        });
        return instance;
    }

    function isProxyFailure(error) {
        if (!error || !error.response) {
            return true;
        }
        const status = error.response.status;
        const body = error.response.data;
        if (status === 404) {
            if (typeof body === "string" && body.includes("NOT_FOUND")) {
                return true;
            }
            if (body && body.message === "GitHub token not configured") {
                return true;
            }
        }
        return status >= 500;
    }

    function trackRate(response) {
        const left = response && response.headers && response.headers["x-ratelimit-remaining"];
        if (left !== undefined && left !== null && left !== "") {
            window.GitLensRate.requestsLeft = parseInt(left, 10);
        }
        return response;
    }

    async function apiGet(path, config) {
        if (usesServerProxy()) {
            try {
                return trackRate(await proxyClient().get(path, config));
            } catch (error) {
                if (!isProxyFailure(error)) {
                    throw error;
                }
            }
        }
        return trackRate(await directClient().get(path, config));
    }

    async function refreshRate() {
        try {
            const res = await apiGet("/rate_limit");
            const core = res.data && res.data.resources && res.data.resources.core;
            if (core) {
                window.GitLensRate.requestsLeft = core.remaining;
            }
        } catch (e) {}
    }

    function lastPageFromLink(linkHeader) {
        if (!linkHeader) return null;
        const match = linkHeader.split(",").find(p => p.includes('rel="last"'));
        if (!match) return null;
        const pageMatch = match.match(/[?&]page=(\d+)/);
        return pageMatch ? parseInt(pageMatch[1], 10) : null;
    }

    async function fetchAllRepos(login) {
        let repos = [];
        let page = 1;
        while (true) {
            const res = await apiGet(`/users/${login}/repos`, {
                params: {per_page: 100, page: page, type: "owner", sort: "pushed"}
            });
            repos = repos.concat(res.data);
            if (res.data.length < 100) break;
            page++;
            if (page > 10) break;
        }
        return repos.filter(r => !r.fork);
    }

    async function commitCountForRepo(login, repo) {
        try {
            const res = await apiGet(`/repos/${login}/${repo}/commits`, {
                params: {author: login, per_page: 1}
            });
            const last = lastPageFromLink(res.headers && res.headers.link);
            if (last !== null) return last;
            return res.data.length;
        } catch (e) {
            return 0;
        }
    }

    async function recentCommitDates(login, repo) {
        try {
            const res = await apiGet(`/repos/${login}/${repo}/commits`, {
                params: {author: login, per_page: 100}
            });
            return res.data
                .map(c => c.commit && c.commit.author && c.commit.author.date)
                .filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    function quarterOf(dateStr) {
        const d = new Date(dateStr);
        const q = Math.floor(d.getMonth() / 3) + 1;
        return d.getFullYear() + " Q" + q;
    }

    function sortByValueDesc(obj) {
        return Object.entries(obj).sort((a, b) => b[1] - a[1]);
    }

    function top10(entries) {
        const out = {};
        entries.slice(0, 10).forEach(([k, v]) => out[k] = v);
        return out;
    }

    async function buildProfile(login, onProgress) {
        onProgress && onProgress("Loading profile…");

        const userRes = await apiGet(`/users/${login}`);
        const u = userRes.data;
        const user = {
            login: u.login,
            name: u.name,
            avatarUrl: u.avatar_url,
            publicRepos: u.public_repos,
            createdAt: u.created_at,
            htmlUrl: u.html_url
        };

        onProgress && onProgress("Loading repositories…");
        const repos = await fetchAllRepos(login);

        const langRepoCount = {};
        const langStarCount = {};
        const repoStarCount = {};
        const repoDescriptions = {};

        repos.forEach(r => {
            const lang = r.language || UNKNOWN_LANGUAGE;
            langRepoCount[lang] = (langRepoCount[lang] || 0) + 1;
            langStarCount[lang] = (langStarCount[lang] || 0) + (r.stargazers_count || 0);
            repoDescriptions[r.name] = r.description;
            if (r.stargazers_count > 0) {
                repoStarCount[r.name] = r.stargazers_count;
            }
        });

        onProgress && onProgress("Counting commits…");
        const reposForCommits = repos.slice(0, 40);
        const repoCommitCountAll = {};
        const langCommitCount = {};
        for (const r of reposForCommits) {
            const count = await commitCountForRepo(login, r.name);
            if (count > 0) {
                repoCommitCountAll[r.name] = count;
                const lang = r.language || UNKNOWN_LANGUAGE;
                langCommitCount[lang] = (langCommitCount[lang] || 0) + count;
            }
        }

        onProgress && onProgress("Building activity timeline…");
        const topCommitRepos = sortByValueDesc(repoCommitCountAll).slice(0, 8).map(e => e[0]);
        const quarterBuckets = {};
        const allDates = [];
        for (const repoName of topCommitRepos) {
            const dates = await recentCommitDates(login, repoName);
            dates.forEach(d => allDates.push(d));
        }
        allDates.forEach(d => {
            const q = quarterOf(d);
            quarterBuckets[q] = (quarterBuckets[q] || 0) + 1;
        });
        const quarterCommitCount = fillQuarters(quarterBuckets);

        const sortedLangRepo = {};
        sortByValueDesc(langRepoCount).forEach(([k, v]) => sortedLangRepo[k] = v);
        const sortedLangStar = {};
        sortByValueDesc(langStarCount).forEach(([k, v]) => { if (v > 0) sortedLangStar[k] = v; });
        const sortedLangCommit = {};
        sortByValueDesc(langCommitCount).forEach(([k, v]) => sortedLangCommit[k] = v);

        return {
            user,
            langRepoCount: sortedLangRepo,
            langStarCount: sortedLangStar,
            langCommitCount: sortedLangCommit,
            repoCommitCount: top10(sortByValueDesc(repoCommitCountAll)),
            repoStarCount: top10(sortByValueDesc(repoStarCount)),
            repoCommitCountDescriptions: repoDescriptions,
            repoStarCountDescriptions: repoDescriptions,
            quarterCommitCount: quarterCommitCount
        };
    }

    function fillQuarters(buckets) {
        const keys = Object.keys(buckets);
        if (!keys.length) return {};
        const parse = k => {
            const [y, q] = k.split(" Q");
            return parseInt(y, 10) * 4 + (parseInt(q, 10) - 1);
        };
        const sorted = keys.sort((a, b) => parse(a) - parse(b));
        let start = parse(sorted[0]);
        const end = parse(sorted[sorted.length - 1]);
        const out = {};
        for (let i = start; i <= end; i++) {
            const year = Math.floor(i / 4);
            const q = (i % 4) + 1;
            const label = year + " Q" + q;
            out[label] = buckets[label] || 0;
        }
        return out;
    }

    window.GitLens = {
        buildProfile,
        getToken,
        setToken,
        refreshRate
    };
})();
