/* GitLens — Vue components and client-side routing */

Vue.component("app-frame", {
    template: "#app-frame"
});

Vue.component("site-header", {
    template: "#site-header"
});

Vue.component("loading-bouncer", {
    template: "#loading-bouncer",
    props: {
        status: {type: String, default: "Analyzing GitHub profile"}
    }
});

Vue.component("share-bar", {
    template: "#share-bar",
    props: ["user"],
    data: () => ({
        copied: false
    }),
    computed: {
        profileUrl() {
            return window.location.origin + window.location.pathname + "?user=" + this.user.login;
        },
        shareText() {
            return this.user.login + "'s GitHub profile, visualized with GitLens:";
        },
        twitterUrl() {
            return "https://twitter.com/intent/tweet?url=" + encodeURIComponent(this.profileUrl) + "&text=" + encodeURIComponent(this.shareText) + "&via=gitlensinfo&related=gitlensinfo";
        },
        copyButtonText() {
            return this.copied ? "Copied!" : "Copy Link";
        }
    },
    methods: {
        copyLink() {
            const url = this.profileUrl;
            const done = () => {
                this.copied = true;
                setTimeout(() => { this.copied = false; }, 2000);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(done);
            } else {
                const textArea = document.createElement("textarea");
                textArea.value = url;
                textArea.style.position = "fixed";
                textArea.style.left = "-999999px";
                document.body.appendChild(textArea);
                textArea.select();
                try {
                    document.execCommand("copy");
                    done();
                } catch (err) {
                    console.error("Failed to copy:", err);
                }
                document.body.removeChild(textArea);
            }
        }
    }
});

Vue.component("user-info", {
    template: "#user-info",
    props: ["user", "data"],
    computed: {
        timeAgo() {
            return moment(this.user.createdAt).fromNow();
        }
    },
    mounted() {
        lineChart("quarterCommitCount", this.data);
    }
});

Vue.component("donut-charts", {
    template: "#donut-charts",
    props: ["data"],
    computed: {
        maxLangStars() {
            const values = Object.values(this.data.langStarCount || {});
            return values.length ? Math.max(...values) : 0;
        }
    },
    mounted() {
        donutChart("langRepoCount", this.data);
        donutChart("langStarCount", this.data);
        donutChart("langCommitCount", this.data);
        donutChart("repoCommitCount", this.data);
        donutChart("repoStarCount", this.data);
    }
});

Vue.component("search-view", {
    template: "#search-view",
    data: () => ({
        error: null,
        failedQuery: "",
        query: "",
        token: GitLens.getToken(),
        showToken: false
    }),
    methods: {
        search() {
            if (!this.query.trim()) return;
            GitLens.setToken(this.token.trim());
            this.$emit("navigate", this.query.trim());
        },
        toggleToken() {
            this.showToken = !this.showToken;
        }
    }
});

Vue.component("user-view", {
    template: "#user-view",
    props: ["login"],
    data: () => ({
        data: null,
        user: null,
        error: null,
        status: "Analyzing GitHub profile"
    }),
    created() {
        GitLens.buildProfile(this.login, (msg) => { this.status = msg; })
            .then(data => {
                this.data = data;
                this.user = data.user;
            })
            .catch(error => { this.error = error; });
    },
    methods: {
        back() {
            this.$emit("back");
        }
    }
});

new Vue({
    el: "#main-vue",
    data: {
        login: getUserFromUrl()
    },
    created() {
        window.addEventListener("popstate", () => {
            this.login = getUserFromUrl();
        });
    },
    methods: {
        navigate(login) {
            this.login = login;
            history.pushState({login}, "", "?user=" + encodeURIComponent(login));
        },
        back() {
            this.login = null;
            history.pushState({}, "", window.location.pathname);
        }
    }
});

function getUserFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const user = params.get("user");
    return user && user.trim() ? user.trim() : null;
}
