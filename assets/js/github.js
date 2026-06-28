/*
 * GitLens — GitHub data aggregation (matches profile-summary-for-github.com logic).
 * Uses contributors + participation stats for reliable commit counts.
 */
(function () {
    const DIRECT_API = "https://api.github.com";
    const TOKEN_KEY = "gitlens-token";

    function usesServerProxy() {
        const host = window.location.hostname;
        return host !== "localhost" && host !== "127.0.0.1";
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

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

    async function apiGet(path, config) {
        if (usesServerProxy()) {
            try {
                return await proxyClient().get(path, config);
            } catch (error) {
                if (!isProxyFailure(error)) {
                    throw error;
                }
            }
        }
        return directClient().get(path, config);
    }

    async function fetchStats(path) {
        for (let attempt = 0; attempt < 6; attempt++) {
            try {
                const res = await apiGet(path);
                if (res.status === 202) {
                    await sleep(1500 + attempt * 500);
                    continue;
                }
                return res.data;
            } catch (e) {
                if (attempt === 5) {
                    return null;
                }
                await sleep(1000);
            }
        }
        return null;
    }

    async function contributorCommits(login, repo) {
        try {
            const res = await apiGet(`/repos/${login}/${repo}/contributors`, {
                params: {anon: "true", per_page: 100}
            });
            const match = res.data.find(c =>
                c.login && c.login.toLowerCase() === login.toLowerCase()
            );
            return match ? match.contributions : 0;
        } catch (e) {
            return 0;
        }
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

    function quarterOf(dateStr) {
        const d = new Date(dateStr);
        const q = Math.floor(d.getMonth() / 3) + 1;
        return d.getFullYear() + " Q" + q;
    }

    function parseQuarter(label) {
        const [y, q] = label.split(" Q");
        return parseInt(y, 10) * 4 + (parseInt(q, 10) - 1);
    }

    function formatQuarter(index) {
        const year = Math.floor(index / 4);
        const q = (index % 4) + 1;
        return year + " Q" + q;
    }

    function fillQuartersFromJoin(buckets, createdAt) {
        const start = parseQuarter(quarterOf(createdAt));
        const end = parseQuarter(quarterOf(new Date().toISOString()));
        const out = {};
        for (let i = start; i <= end; i++) {
            const label = formatQuarter(i);
            out[label] = buckets[label] || 0;
        }
        return out;
    }

    function addParticipationToQuarters(ownerWeeks, buckets) {
        if (!ownerWeeks || !ownerWeeks.length) return;
        const total = ownerWeeks.length;
        ownerWeeks.forEach((count, i) => {
            if (!count) return;
            const weeksFromEnd = total - 1 - i;
            const weekDate = new Date(Date.now() - weeksFromEnd * 7 * 24 * 3600 * 1000);
            const q = quarterOf(weekDate.toISOString());
            buckets[q] = (buckets[q] || 0) + count;
        });
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
        const repoCommitCountAll = {};
        const langCommitCount = {};
        const quarterBuckets = {};

        for (const r of repos) {
            const count = await contributorCommits(login, r.name);
            if (count > 0) {
                repoCommitCountAll[r.name] = count;
                const lang = r.language || UNKNOWN_LANGUAGE;
                langCommitCount[lang] = (langCommitCount[lang] || 0) + count;
            }

            const participation = await fetchStats(`/repos/${login}/${r.name}/stats/participation`);
            if (participation && participation.owner) {
                addParticipationToQuarters(participation.owner, quarterBuckets);
            }
        }

        const quarterCommitCount = fillQuartersFromJoin(quarterBuckets, user.createdAt);

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

    window.GitLens = {
        buildProfile,
        getToken,
        setToken
    };
})();
