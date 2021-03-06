import configs from '../Configs'
import {getBrowser, replaceAll} from '../utils/MiscUtils';
import {doesBrowserNotSupportResponseFiltering} from "../utils/BrowserDetection";
import editorUrls from "../utils/EditorURLs";
import {MESSAGE_KEY_DOM_LOADED} from "../MiscConstants";
import {getHooks, injectHooks} from "../HookUtils";

if (doesBrowserNotSupportResponseFiltering()) {

    const isEditorRequest = (request) => {
        const url = request.url;

        if(url.startsWith("https://app.roll20.net/editor/setcampaign/")) {
            return true;
        }

        if(url === "https://app.roll20.net/editor/") {
            return true;
        }

        if(url === "https://app.roll20.net/editor") {
            return true;
        }

        if(url.startsWith("https://app.roll20.net/editor?")) {
            return true;
        }

        if(url.startsWith("https://app.roll20.net/editor#")) {
            return true;
        }

        return false;
    };

    const targetScripts = [
        "https://app.roll20.net/v2/js/jquery",
        "https://app.roll20.net/v2/js/jquery.migrate.js",
        "https://app.roll20.net/js/featuredetect.js",
        "https://app.roll20.net/v2/js/patience.js",
        "https://app.roll20.net/editor/startjs",
        "https://app.roll20.net/js/jquery-ui",
        "https://app.roll20.net/js/d20/loading.js",
        "https://app.roll20.net/assets/firebase",
        "https://app.roll20.net/assets/base.js",
        "https://app.roll20.net/assets/app.js",
        "https://app.roll20.net/js/tutorial_tips.js"
    ];

    let alreadyRedirected = {};
    let redirectQueue = [];
    let isRedirecting = false;

    const beginRedirectQueue = () => {
        if(isRedirecting) {
            return;
        }

        isRedirecting = true;
        alreadyRedirected = {};
        redirectQueue = [];

        console.log("Beginning redirect queue.");
    };

    const endRedirectQueue = () => {
        console.log("Ending redirect queue.");
        isRedirecting = false;
    };

    getBrowser().runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if(msg[MESSAGE_KEY_DOM_LOADED]) {
            endRedirectQueue();

            console.log("Received MESSAGE_KEY_DOM_LOADED from content script, responding with redirectQueue:", redirectQueue);
            sendResponse(redirectQueue);
        }
    });

    window.requestListener = function(request) {
        if(isEditorRequest(request)) {
            console.log("Editor, blocking:", request.url, request);
            beginRedirectQueue();
        }
        else if(request.type === "script") {
            for(const url of targetScripts) {

                if(request.url.startsWith(url)) {
                    beginRedirectQueue();

                    if (alreadyRedirected[request.url]) {
                        console.log(`not queueing request due to alreadyRedirected: ${request.url}`, request);
                    }
                    else {
                        console.log(`queueing ${request.url}`);
                        redirectQueue.push(request.url);
                        alreadyRedirected[request.url] = true;

                        return {
                            cancel: true
                        };
                    }

                    break;
                }
            }
        }
    };

    {
        const headerCallback = (req) => {

            if(!isEditorRequest(req)) {
                return;
            }

            console.log("Editor, headers:", req.url, req);
            beginRedirectQueue();

            console.log(`HEADER CALLBACK (processing headers) for ${req.url}`, req);

            const headers = JSON.parse(JSON.stringify(req.responseHeaders));

            let idx = headers.length;
            while (idx-- > 0) {
                const header = headers[idx];

                const name = header.name.toLowerCase();
                if (name !== "content-security-policy") {
                    console.log(`ignoring header ${name}`);
                    continue;
                }

                header.value += " blob:";
                console.log("!!MODIFIED HEADERS!!");
                break;
            }

            return {responseHeaders: headers};
        };

        chrome.webRequest.onHeadersReceived.addListener(
            headerCallback,
            {urls: editorUrls},
            ["blocking", "responseHeaders"]);
    }
}
else {

    const redirectTargets = [
        "https://app.roll20.net/v2/js/jquery",
        "https://app.roll20.net/js/featuredetect.js",
        "https://app.roll20.net/editor/startjs",
        "https://app.roll20.net/js/jquery",
        "https://app.roll20.net/js/d20/loading.js",
        "https://app.roll20.net/assets/firebase",
        "https://app.roll20.net/assets/base.js",
        "https://app.roll20.net/assets/app.js",
        "https://app.roll20.net/js/tutorial_tips.js",
    ];

    const isRedirectTarget = (url) => typeof(redirectTargets.find(f => url.startsWith(f))) !== "undefined";

    // thanks, Firefox.
    window.requestListener = function (dt) {
        const isRedir = isRedirectTarget(dt.url);
        console.log(`${isRedir}: ${dt.url}`);
        if (!isRedir) return;

        const hookQueue = getHooks(configs, dt.url);
        const filter = getBrowser().webRequest.filterResponseData(dt.requestId);
        const decoder = new TextDecoder("utf-8");

        // Note(Justas): the console.log here forces scripts to run in order
        // and not randomly, avoiding race conditions
        let stringBuffer = `console.log("running ${dt.url}");`;

        filter.ondata = e => {
            stringBuffer += decoder.decode(e.data, {stream: true});
        };

        filter.onstop = e => {

            const hookedData = injectHooks(stringBuffer, hookQueue, replaceAll);

            filter.write(new TextEncoder().encode(hookedData));
            filter.close();
        };
    }
}

getBrowser().webRequest.onBeforeRequest.addListener(
    window.requestListener,
    {urls: ["*://app.roll20.net/*"]},
    ["blocking"]);

console.log("window.r20es Background hook script initialized");
