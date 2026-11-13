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
    let pending = emptyPending();
    let syncState = "local";
    let syncMessage = "";
    let syncPromise = null;

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

    function emptyPending() {
        return {
            settings: {},
            deliveries: {},
            trading: {}
        };
    }

    function hasPending(value = pending) {
        return Object.keys(value.settings).length > 0 ||
            Object.keys(value.deliveries).length > 0 ||
            Object.keys(value.trading).length > 0;
    }

    function same(left, right) {
        return JSON.stringify(left) === JSON.stringify(right);
    }

    function changesBetween(previous, next) {
        const changes = emptyPending();

        if (!same(previous.settings.lossWon, next.settings.lossWon)) {
            changes.settings.lossWon = next.settings.lossWon;
        }

        if (!same(previous.settings.plan, next.settings.plan)) {
            changes.settings.plan = clone(next.settings.plan);
        }

        ["deliveries", "trading"].forEach(category => {
            const dates = new Set([
                ...Object.keys(previous[category]),
                ...Object.keys(next[category])
            ]);

            dates.forEach(date => {
                const before = previous[category][date];
                const after = next[category][date];

                if (!same(before, after)) {
                    changes[category][date] = after === undefined
                        ? null
                        : clone(after);
                }
            });
        });

        return changes;
    }

    function mergePending(previous, changes) {
        return {
            settings: {
                ...previous.settings,
                ...changes.settings
            },
            deliveries: {
                ...previous.deliveries,
                ...changes.deliveries
            },
            trading: {
                ...previous.trading,
                ...changes.trading
            }
        };
    }

    function normalizePending(raw) {
        object(raw, "미동기 변경분");

        const result = emptyPending();
        const settings = object(raw.settings, "미동기 설정");
        const deliveries = object(raw.deliveries, "미동기 수입");
        const trading = object(raw.trading, "미동기 트레이딩");

        if (Object.prototype.hasOwnProperty.call(settings, "lossWon")) {
            result.settings.lossWon = storedWon(settings.lossWon, true);
        }

        if (Object.prototype.hasOwnProperty.call(settings, "plan")) {
            result.settings.plan = C.plan(
                object(settings.plan, "미동기 계획")
            );
        }

        Object.entries(deliveries).forEach(([date, record]) => {
            C.recordDate(date);

            result.deliveries[date] = record === null
                ? null
                : deliveryRecord(record);
        });

        Object.entries(trading).forEach(([date, record]) => {
            C.recordDate(date);

            result.trading[date] = record === null
                ? null
                : tradingRecord(record);
        });

        return result;
    }

    function applyPending(source, changes) {
        const next = clone(source);

        if (Object.prototype.hasOwnProperty.call(changes.settings, "lossWon")) {
            next.settings.lossWon = changes.settings.lossWon;
        }

        if (Object.prototype.hasOwnProperty.call(changes.settings, "plan")) {
            next.settings.plan = clone(changes.settings.plan);
        }

        ["deliveries", "trading"].forEach(category => {
            Object.entries(changes[category]).forEach(([date, record]) => {
                if (record === null) {
                    delete next[category][date];
                } else {
                    next[category][date] = clone(record);
                }
            });
        });

        return validate(next);
    }

    function writeState(next, nextPending) {
        const clean = validate(next);
        const cleanPending = normalizePending(nextPending);

        const serialized = JSON.stringify({
            ...clean,
            _sync: {
                version: 1,
                pending: cleanPending
            }
        });

        assertUnchanged();

        try {
            localStorage.setItem(KEY, serialized);
        } catch (error) {
            throw new Error(
                "브라우저 저장에 실패했습니다. 저장 공간과 권한을 확인하세요. " +
                "입력은 아직 안전하게 저장되지 않았습니다."
            );
        }

        baseline = serialized;
        state = clean;
        pending = cleanPending;

        return get();
    }

    function getSyncState() {
        return syncState;
    }

    function getSyncMessage() {
        return syncMessage;
    }

    function init() {
        try {
            baseline = localStorage.getItem(KEY);
        } catch (error) {
            throw new Error(
                "브라우저 저장소에 접근할 수 없습니다. 사이트 저장 권한을 확인하세요."
            );
        }

        if (baseline === null) {
            state = empty();
            pending = emptyPending();
            syncState = "local";
            syncMessage = "아직 저장된 기록이 없습니다.";

            return get();
        }

        try {
            const parsed = JSON.parse(baseline);
            const clean = validate(parsed);

            let restoredPending;

            if (parsed._sync !== undefined) {
                object(parsed._sync, "동기화 정보");

                if (parsed._sync.version !== 1) {
                    throw new Error("지원하지 않는 동기화 정보 버전입니다.");
                }

                restoredPending = normalizePending(parsed._sync.pending);
            } else {
                restoredPending = changesBetween(empty(), clean);
            }

            state = applyPending(clean, restoredPending);
            pending = restoredPending;

            syncState = hasPending() ? "pending" : "local";
            syncMessage = hasPending()
                ? "이 기기의 변경분을 GitHub에 반영해야 합니다."
                : "GitHub 최신 기록을 확인하기 전입니다.";
        } catch (error) {
            throw new Error(
                "기존 저장 데이터를 읽지 못했습니다. " + error.message
            );
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
        const previous = state ? clone(state) : empty();
        const changes = changesBetween(previous, clean);
        const nextPending = mergePending(pending, changes);

        const result = writeState(clean, nextPending);

        syncState = hasPending() ? "pending" : syncState;
        syncMessage = hasPending()
            ? "브라우저에 저장했습니다. GitHub 반영을 기다립니다."
            : syncMessage;

        return result;
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
        const fallback = {
            owner: "",
            repo: "",
            branch: "main",
            sha: null
        };

        const match = location.hostname.match(/^([^.]+)\.github\.io$/);

        if (match) {
            const owner = match[1];
            const firstSegment = location.pathname
                .split("/")
                .filter(Boolean)[0];

            fallback.owner = owner;
            fallback.repo =
                firstSegment && !firstSegment.includes(".")
                    ? firstSegment
                    : owner + ".github.io";
        }

        try {
            const saved = JSON.parse(
                localStorage.getItem(GITHUB_KEY) || "null"
            );

            if (saved && typeof saved === "object") {
                return {
                    owner: String(saved.owner || ""),
                    repo: String(saved.repo || ""),
                    branch: String(saved.branch || "main"),
                    sha: typeof saved.sha === "string"
                        ? saved.sha
                        : null
                };
            }
        } catch (error) {
            console.warn("GitHub 연결 정보를 읽지 못했습니다.", error);
        }

        return fallback;
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

        syncState = hasPending() ? "pending" : "local";
        syncMessage = "GitHub 연결 정보를 저장했습니다. 최신 기록을 확인합니다.";
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
            current.branch !== expected.branch) {
            throw new Error(
                "다른 작업에서 GitHub 연결 대상이 변경되었습니다. 다시 시도하세요."
            );
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

    function assertSnapshot(expected) {
        assertUnchanged(expected);

        if (baseline !== expected) {
            throw new Error(
                "동기화 도중 이 기기의 기록이 변경되었습니다. " +
                "변경분은 유지됩니다. 다시 동기화하세요."
            );
        }
    }

    function rememberRemote(config, sha) {
        try {
            assertConnection(config);

            localStorage.setItem(GITHUB_KEY, JSON.stringify({
                owner: config.owner,
                repo: config.repo,
                branch: config.branch,
                sha
            }));
        } catch (error) {
            console.warn("원격 버전 정보를 별도로 저장하지 못했습니다.", error);
        }
    }

    async function performSync() {
        syncState = "syncing";
        syncMessage = "GitHub 최신 기록과 이 기기의 변경분을 확인하고 있습니다.";

        try {
            const config = connection();
            const tokenAtStart = getToken();

            for (let attempt = 0; attempt < 3; attempt += 1) {
                const expected = baseline;
                const snapshot = clone(pending);
                const file = await remoteFile(config);

                assertSnapshot(expected);
                assertConnection(config);

                const remote = file
                    ? validate(JSON.parse(decodeBase64(file.content)))
                    : empty();

                const merged = applyPending(remote, snapshot);

                if (!hasPending(snapshot)) {
                    if (!file) {
                        syncState = "local";
                        syncMessage =
                            "원격 데이터 파일이 아직 없거나 접근할 수 없습니다.";

                        return {
                            ok: false,
                            reason:
                                "GitHub 데이터 파일이 아직 없거나 접근할 수 없습니다. " +
                                "연결 정보와 권한을 확인하세요. 새 프로젝트라면 첫 저장 후 생성합니다."
                        };
                    }

                    writeState(merged, emptyPending());
                    rememberRemote(config, file.sha);

                    syncState = "ok";
                    syncMessage = "GitHub 최신 기록을 불러왔습니다.";

                    return { ok: true, uploaded: false };
                }

                if (!tokenAtStart) {
                    writeState(merged, snapshot);

                    if (file) {
                        rememberRemote(config, file.sha);
                    }

                    syncState = "pending";
                    syncMessage =
                        "토큰이 없어 변경분을 이 기기에 보관하고 있습니다.";

                    return {
                        ok: false,
                        reason:
                            "GitHub 토큰이 없어 업로드하지 못했습니다. " +
                            "설정에서 토큰을 저장하면 다시 시도합니다."
                    };
                }

                if (getToken() !== tokenAtStart) {
                    throw new Error(
                        "작업 중 GitHub 토큰이 변경되었습니다. 다시 동기화하세요."
                    );
                }

                const body = {
                    message: "data: 회복 기록 자동 동기화",
                    branch: config.branch,
                    content: encodeBase64(
                        JSON.stringify(merged, null, 2) + "\n"
                    )
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

                if (response.status === 409 ||
                    response.status === 422) {
                    if (attempt < 2) {
                        await new Promise(resolve => {
                            window.setTimeout(resolve, 400 * (attempt + 1));
                        });

                        continue;
                    }

                    throw new Error(
                        "원격 버전 충돌 또는 업로드 조건 오류가 계속 발생했습니다. " +
                        "이 기기의 변경분은 남겨두었습니다. 다시 시도하세요."
                    );
                }

                if (!response.ok) {
                    throw new Error(
                        result.message ||
                        `GitHub 업로드 실패 (${response.status})`
                    );
                }

                if (!result.content ||
                    typeof result.content.sha !== "string") {
                    throw new Error(
                        "업로드 결과의 파일 버전을 확인하지 못했습니다. " +
                        "변경분을 보존했으니 다시 동기화하세요."
                    );
                }

                assertConnection(config);
                assertSnapshot(expected);

                writeState(merged, emptyPending());
                rememberRemote(config, result.content.sha);

                syncState = "ok";
                syncMessage = "현재 변경분이 GitHub에도 반영되었습니다.";

                return { ok: true, uploaded: true };
            }

            throw new Error(
                "동기화를 완료하지 못했습니다. 변경분은 이 기기에 유지됩니다."
            );
        } catch (error) {
            syncState = hasPending() ? "pending" : "error";
            syncMessage = error.message || "GitHub 동기화에 실패했습니다.";

            return {
                ok: false,
                reason: syncMessage
            };
        }
    }

    function sync() {
        if (syncPromise) {
            return syncPromise;
        }

        syncPromise = performSync().finally(() => {
            syncPromise = null;
        });

        return syncPromise;
    }

    function load() {
        return sync();
    }

    function pullGithub() {
        return sync();
    }

    function pushGithub() {
        return sync();
    }

    return Object.freeze({
        KEY,
        init,
        load,
        sync,
        hasPending,
        getSyncState,
        getSyncMessage,
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