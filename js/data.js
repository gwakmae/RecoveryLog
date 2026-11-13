"use strict";

window.RecoveryLog = window.RecoveryLog || {};

RecoveryLog.Data = (() => {
    const C = RecoveryLog.Calc;

    const KEY = "recovery_log_v1";
    const GITHUB_KEY = "recovery_log_github_v1";
    const TOKEN_KEY = "recovery_log_github_token_v1";
    const REMOTE_PATH = "data/recovery-log.json";

    let state = null;
    let baseline = null;

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function empty() {
        return {
            project: "delivery-recovery",
            schemaVersion: 1,
            settings: {
                lossWon: null,
                plan: {
                    daily: 40000,
                    start: C.addDays(C.today(), 1),
                    deadline: null
                }
            },
            deliveries: {},
            trading: {}
        };
    }

    function object(value, label) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error(`${label} 형식이 올바르지 않습니다.`);
        }

        return value;
    }

    function note(value) {
        if (value === undefined || value === null) {
            return "";
        }

        if (typeof value !== "string" || value.length > 2000) {
            throw new Error("메모는 2,000자 이하 문자열이어야 합니다.");
        }

        return value.trim();
    }

    function storedWon(value, nullable = false, maximum = C.MAX_WON) {
        if (nullable && value === null) {
            return null;
        }

        if (typeof value !== "number" ||
            !Number.isSafeInteger(value) ||
            value < 0 ||
            value > maximum) {
            throw new Error("저장된 원화 금액을 확인하세요.");
        }

        return value;
    }

    function deliveryRecord(raw) {
        object(raw, "수입 기록");

        const hasOwn = key =>
            Object.prototype.hasOwnProperty.call(raw, key);

        const isLegacy =
            raw.mode === undefined &&
            hasOwn("morning") &&
            hasOwn("afternoon");

        if (isLegacy) {
            const morning = storedWon(raw.morning, true);
            const afternoon = storedWon(raw.afternoon, true);

            if (morning === null && afternoon === null) {
                throw new Error("기존 배달 기록에 수입이 없습니다.");
            }

            return {
                mode: "combined",
                coupang: null,
                baemin: null,
                combined: C.safe(
                    (morning ?? 0) + (afternoon ?? 0),
                    "기존 배달 합계"
                ),
                other: null,
                note: note(raw.note)
            };
        }

        if (raw.mode !== "detail" && raw.mode !== "combined") {
            throw new Error("수입 입력 방식은 상세 또는 합산이어야 합니다.");
        }

        const readOptional = (key, maximum = C.MAX_WON) => {
            const value = raw[key];

            return value === undefined || value === null
                ? null
                : storedWon(value, false, maximum);
        };

        const coupang = readOptional("coupang");
        const baemin = readOptional("baemin");
        const combined = readOptional("combined", C.MAX_WON * 2);
        const other = readOptional("other");

        if (raw.mode === "detail" && combined !== null) {
            throw new Error(
                "상세 입력에는 배달 합산 금액을 함께 저장할 수 없습니다."
            );
        }

        if (raw.mode === "combined" &&
            (coupang !== null || baemin !== null)) {
            throw new Error(
                "합산 입력에는 쿠팡·배민 금액을 함께 저장할 수 없습니다."
            );
        }

        const cleaned = {
            mode: raw.mode,
            coupang: raw.mode === "detail" ? coupang : null,
            baemin: raw.mode === "detail" ? baemin : null,
            combined: raw.mode === "combined" ? combined : null,
            other,
            note: note(raw.note)
        };

        if (!C.hasDelivery(cleaned) && other === null) {
            throw new Error(
                "배달 또는 그 외 수입이 하나 이상 필요합니다. 무수입은 0으로 기록하세요."
            );
        }

        C.deliveryAmount(cleaned);

        return cleaned;
    }

    function tradingRecord(raw) {
        object(raw, "트레이딩 기록");

        if (typeof raw.rate !== "number") {
            throw new Error("저장 환율은 숫자여야 합니다.");
        }

        const rate = C.rate(raw.rate);

        if (!Number.isSafeInteger(raw.rebateCents) ||
            raw.rebateCents < 0 ||
            raw.rebateCents > C.MAX_CENTS) {
            throw new Error("리베이트 금액을 확인하세요.");
        }

        if (!Array.isArray(raw.positions) || raw.positions.length > 2000) {
            throw new Error("포지션 배열은 최대 2,000건이어야 합니다.");
        }

        const tickets = new Set();
        const positions = raw.positions.map((rawPosition, index) => {
            object(rawPosition, "포지션");

            if (typeof rawPosition.symbol !== "string" ||
                typeof rawPosition.lots !== "number") {
                throw new Error("포지션 종목과 랏수 형식을 확인하세요.");
            }

            const position = C.position(rawPosition, index + 1);

            if (position.ticket) {
                if (tickets.has(position.ticket)) {
                    throw new Error("같은 날짜에 중복 거래번호가 있습니다.");
                }

                tickets.add(position.ticket);
            }

            return position;
        });

        if (!positions.length && raw.rebateCents === 0) {
            throw new Error("빈 트레이딩 기록은 저장할 수 없습니다.");
        }

        const result = {
            rate,
            rebateCents: raw.rebateCents,
            positions,
            note: note(raw.note)
        };

        C.tradeDay(result);

        return result;
    }

    function validate(raw) {
        object(raw, "백업");

        if (raw.project !== "delivery-recovery" || raw.schemaVersion !== 1) {
            throw new Error("이 새 프로젝트의 버전 1 백업 파일만 복원할 수 있습니다.");
        }

        object(raw.settings, "설정");
        object(raw.settings.plan, "계획");

        const clean = {
            project: "delivery-recovery",
            schemaVersion: 1,
            settings: {
                lossWon: storedWon(raw.settings.lossWon, true),
                plan: C.plan(raw.settings.plan)
            },
            deliveries: {},
            trading: {}
        };

        const deliveries = object(raw.deliveries, "배달 목록");
        const trading = object(raw.trading, "트레이딩 목록");

        Object.entries(deliveries).forEach(([date, record]) => {
            C.recordDate(date);
            clean.deliveries[date] = deliveryRecord(record);
        });

        Object.entries(trading).forEach(([date, record]) => {
            C.recordDate(date);
            clean.trading[date] = tradingRecord(record);
        });

        C.totals(clean);

        return clean;
    }

    function init() {
        try {
            baseline = localStorage.getItem(KEY);
        } catch (error) {
            throw new Error("브라우저 저장소에 접근할 수 없습니다. 사이트 저장 권한을 확인하세요.");
        }

        if (baseline === null) {
            state = empty();
            return get();
        }

        try {
            state = validate(JSON.parse(baseline));
        } catch (error) {
            throw new Error("기존 저장 데이터를 읽지 못했습니다. " + error.message);
        }

        return get();
    }

    function get() {
        if (!state) {
            throw new Error("데이터가 아직 준비되지 않았습니다.");
        }

        return clone(state);
    }

    function raw() {
        try {
            return localStorage.getItem(KEY) || "";
        } catch (error) {
            return baseline || "";
        }
    }

    function assertUnchanged(expected = baseline) {
        const current = localStorage.getItem(KEY);

        if (current !== expected) {
            throw new Error(
                "다른 탭에서 저장 데이터가 변경되었습니다. 현재 입력을 보관한 뒤 새로고침하세요."
            );
        }
    }

    function replace(next) {
        const clean = validate(next);
        const serialized = JSON.stringify(clean);

        assertUnchanged();

        try {
            localStorage.setItem(KEY, serialized);
        } catch (error) {
            throw new Error(
                "브라우저 저장에 실패했습니다. 저장 공간과 권한을 확인하세요. 입력은 아직 저장되지 않았습니다."
            );
        }

        baseline = serialized;
        state = clean;

        return get();
    }

    function update(mutator) {
        const next = get();

        mutator(next);

        return replace(next);
    }

    function saveDelivery(date, record) {
        C.recordDate(date);

        return update(next => {
            if (record === null) {
                delete next.deliveries[date];
            } else {
                next.deliveries[date] = deliveryRecord(record);
            }
        });
    }

    function saveTrading(date, record) {
        C.recordDate(date);

        return update(next => {
            if (record === null) {
                delete next.trading[date];
            } else {
                next.trading[date] = tradingRecord(record);
            }
        });
    }

    function renameSymbol(oldName, newName) {
        const from = String(oldName).trim().toUpperCase();
        const to = String(newName).trim().toUpperCase();

        if (!from || !to || to.length > 80) {
            throw new Error("기존 종목명과 새 종목명을 확인하세요.");
        }

        let count = 0;

        update(next => {
            Object.values(next.trading).forEach(record => {
                record.positions.forEach(position => {
                    if (position.symbol === from) {
                        position.symbol = to;
                        count += 1;
                    }
                });
            });

            if (!count) {
                throw new Error("저장된 기록에서 해당 종목을 찾지 못했습니다.");
            }
        });

        return count;
    }

    async function fetchJson(url, options = {}) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 20000);

        try {
            return await fetch(url, {
                ...options,
                signal: controller.signal,
                cache: "no-store"
            });
        } catch (error) {
            if (error.name === "AbortError") {
                throw new Error("요청 시간이 초과되었습니다. 다시 시도하세요.");
            }

            throw error;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    async function fetchRate() {
        const response = await fetchJson(
            "https://open.er-api.com/v6/latest/USD"
        );

        if (!response.ok) {
            throw new Error("환율 조회에 실패했습니다. 환율을 직접 입력하세요.");
        }

        const body = await response.json();
        const value = body?.rates?.KRW;

        if (body.result !== "success" ||
            typeof value !== "number" ||
            !Number.isFinite(value)) {
            throw new Error("유효한 환율 응답이 아닙니다. 직접 입력하세요.");
        }

        return C.rate(value.toFixed(6));
    }

    function githubConfig() {
        try {
            const saved = JSON.parse(localStorage.getItem(GITHUB_KEY) || "null");

            if (saved && typeof saved === "object") {
                return {
                    owner: String(saved.owner || ""),
                    repo: String(saved.repo || ""),
                    branch: String(saved.branch || "main"),
                    sha: typeof saved.sha === "string" ? saved.sha : null
                };
            }
        } catch (error) {
            console.warn("GitHub 연결 정보를 읽지 못했습니다.", error);
        }

        return { owner: "", repo: "", branch: "main", sha: null };
    }

    function getToken() {
        try {
            return sessionStorage.getItem(TOKEN_KEY) || "";
        } catch (error) {
            return "";
        }
    }

    function configureGithub(config, token) {
        if (!/^[A-Za-z0-9-]+$/.test(config.owner) ||
            !/^[A-Za-z0-9_.-]+$/.test(config.repo) ||
            !config.branch ||
            config.branch.length > 200) {
            throw new Error("GitHub 소유자, 저장소, 브랜치를 확인하세요.");
        }

        const previous = githubConfig();
        const same =
            previous.owner === config.owner &&
            previous.repo === config.repo &&
            previous.branch === config.branch;

        const next = {
            owner: config.owner,
            repo: config.repo,
            branch: config.branch,
            sha: same ? previous.sha : null
        };

        if (token) {
            sessionStorage.setItem(TOKEN_KEY, token);
        } else {
            sessionStorage.removeItem(TOKEN_KEY);
        }

        localStorage.setItem(GITHUB_KEY, JSON.stringify(next));
    }

    function connection() {
        const config = githubConfig();

        if (!config.owner || !config.repo || !config.branch) {
            throw new Error("GitHub 연결 정보를 먼저 저장하세요.");
        }

        return config;
    }

    function assertConnection(expected) {
        const current = connection();

        if (current.owner !== expected.owner ||
            current.repo !== expected.repo ||
            current.branch !== expected.branch ||
            current.sha !== expected.sha) {
            throw new Error("다른 작업에서 GitHub 연결 상태가 변경되었습니다. 다시 시도하세요.");
        }
    }

    function apiUrl(config) {
        return "https://api.github.com/repos/" +
            encodeURIComponent(config.owner) + "/" +
            encodeURIComponent(config.repo) +
            "/contents/" + REMOTE_PATH;
    }

    function headers() {
        const result = {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28"
        };

        const token = getToken();

        if (token) {
            result.Authorization = "Bearer " + token;
        }

        return result;
    }

    async function remoteFile(config) {
        const response = await fetchJson(
            apiUrl(config) + "?ref=" + encodeURIComponent(config.branch),
            { headers: headers() }
        );

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error(`GitHub 파일 조회 실패 (${response.status})`);
        }

        const file = await response.json();

        if (!file || typeof file.sha !== "string" ||
            typeof file.content !== "string" || file.encoding !== "base64") {
            throw new Error("GitHub 파일 응답 형식이 올바르지 않습니다.");
        }

        return file;
    }

    function encodeBase64(text) {
        const bytes = new TextEncoder().encode(text);
        const parts = [];

        for (let offset = 0; offset < bytes.length; offset += 8192) {
            parts.push(String.fromCharCode.apply(
                null,
                bytes.subarray(offset, offset + 8192)
            ));
        }

        return btoa(parts.join(""));
    }

    function decodeBase64(text) {
        const binary = atob(text.replace(/\s/g, ""));
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }

        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }

    async function pullGithub() {
        const config = connection();
        const expected = baseline;
        const file = await remoteFile(config);

        if (!file) {
            throw new Error(
                "원격 데이터 파일이 없거나 접근할 수 없습니다. 저장소·브랜치·권한을 확인하세요."
            );
        }

        const remote = validate(JSON.parse(decodeBase64(file.content)));

        assertUnchanged(expected);
        assertConnection(config);

        replace(remote);

        localStorage.setItem(GITHUB_KEY, JSON.stringify({
            ...config,
            sha: file.sha
        }));

        return get();
    }

    async function pushGithub() {
        const config = connection();

        if (!getToken()) {
            throw new Error("업로드하려면 토큰을 저장하세요.");
        }

        const expected = baseline;
        const snapshot = get();
        const file = await remoteFile(config);

        assertUnchanged(expected);
        assertConnection(config);

        if (file && file.sha !== config.sha) {
            throw new Error(
                "원격 기록이 변경되었거나 아직 불러오지 않았습니다. " +
                "로컬 JSON을 백업하고 원격 기록을 먼저 확인하세요. 자동 덮어쓰지 않았습니다."
            );
        }

        if (!file && config.sha) {
            throw new Error(
                "이전에 확인한 원격 파일이 사라졌거나 접근할 수 없습니다. 연결 상태를 확인하세요."
            );
        }

        const body = {
            message: "data: 배달 중심 회복 기록 업데이트",
            branch: config.branch,
            content: encodeBase64(JSON.stringify(snapshot, null, 2) + "\n")
        };

        if (file) {
            body.sha = file.sha;
        }

        const response = await fetchJson(apiUrl(config), {
            method: "PUT",
            headers: {
                ...headers(),
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            if (response.status === 409 || response.status === 422) {
                throw new Error(
                    "원격 버전 충돌 또는 업로드 조건 오류입니다. " +
                    "로컬 기록은 유지됩니다. 원격 상태를 확인하세요."
                );
            }

            throw new Error(
                result.message || `GitHub 업로드 실패 (${response.status})`
            );
        }

        if (!result.content || typeof result.content.sha !== "string") {
            throw new Error("업로드 응답의 파일 버전을 확인하지 못했습니다.");
        }

        assertConnection(config);

        localStorage.setItem(GITHUB_KEY, JSON.stringify({
            ...config,
            sha: result.content.sha
        }));

        if (localStorage.getItem(KEY) !== expected) {
            throw new Error(
                "업로드는 완료됐지만 작업 중 다른 탭에서 로컬 기록이 바뀌었습니다. " +
                "현재 로컬 기록은 덮어쓰지 않았습니다. 새로고침 후 확인하세요."
            );
        }
    }

    return Object.freeze({
        KEY,
        init,
        get,
        raw,
        validate,
        replace,
        update,
        saveDelivery,
        saveTrading,
        renameSymbol,
        fetchRate,
        githubConfig,
        getToken,
        configureGithub,
        pullGithub,
        pushGithub
    });
})();