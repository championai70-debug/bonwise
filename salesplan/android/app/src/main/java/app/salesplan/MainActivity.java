package app.salesplan;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Shows the bundled web app (salesplan/web) in a locked-down WebView.
 * - Files are served from the APK through WebViewAssetLoader on a secure https origin.
 * - Any other address is blocked; the app has no internet permission at all.
 * - The page can ask for exactly three things through a message channel that only our own
 *   origin can use: save a file (the user picks where), print / save as PDF, share text.
 */
public class MainActivity extends ComponentActivity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final String START_URL = ORIGIN + "/assets/index.html";
    private static final int MAX_SAVE_CHARS = 60 * 1024 * 1024;
    private static final int MAX_SHARE_CHARS = 100_000;

    private WebView web;
    private WebViewAssetLoader assets;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingSaveText;
    private String pendingSaveName;
    private JavaScriptReplyProxy pendingReply;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    private final ActivityResultLauncher<Intent> openFile = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), result -> {
                if (fileCallback == null) return;
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), result.getData()));
                fileCallback = null;
            });

    private final ActivityResultLauncher<Intent> createFile = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), result -> {
                final String text = pendingSaveText;
                final String name = pendingSaveName;
                final JavaScriptReplyProxy reply = pendingReply;
                pendingSaveText = null;
                pendingSaveName = null;
                pendingReply = null;
                Uri uri = result.getData() != null ? result.getData().getData() : null;
                if (result.getResultCode() != RESULT_OK || uri == null || text == null) {
                    replySaved(reply, false, name);
                    return;
                }
                io.execute(() -> {
                    boolean ok = false;
                    try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                        if (out != null) {
                            out.write(text.getBytes(StandardCharsets.UTF_8));
                            ok = true;
                        }
                    } catch (Exception ignored) {
                        ok = false;
                    }
                    final boolean saved = ok;
                    main.post(() -> replySaved(reply, saved, name));
                });
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false); // no prices in the app switcher

        FrameLayout root = new FrameLayout(this);
        try {
            web = new WebView(this);
        } catch (Exception e) {
            TextView msg = new TextView(this);
            msg.setText(R.string.webview_missing);
            msg.setGravity(Gravity.CENTER);
            msg.setPadding(48, 48, 48, 48);
            root.addView(msg);
            setContentView(root);
            return;
        }
        web.setBackgroundColor(Color.TRANSPARENT);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        assets = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSafeBrowsingEnabled(true);
        s.setSaveFormData(false);
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost()) && "https".equals(url.getScheme())) {
                    WebResourceResponse r = assets.shouldInterceptRequest(url);
                    if (r != null) return r;
                }
                // Everything else is refused: the app never talks to the internet.
                return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", Collections.emptyMap(),
                        new ByteArrayInputStream(new byte[0]));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost()) && "https".equals(url.getScheme())) return false;
                String scheme = url.getScheme() == null ? "" : url.getScheme();
                if (request.hasGesture() && (scheme.equals("https") || scheme.equals("mailto"))) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE));
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(MainActivity.this, R.string.no_app, Toast.LENGTH_SHORT).show();
                    }
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try {
                    openFile.launch(i);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, R.string.no_app, Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny(); // no camera, microphone or other device access
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }
        });

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "AndroidBridge", Collections.singleton(ORIGIN),
                    (view, message, sourceOrigin, isMainFrame, reply) -> {
                        if (isMainFrame && HOST.equals(sourceOrigin.getHost())) onBridgeMessage(message, reply);
                    });
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) {
                    web.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });

        String url = START_URL;
        if (savedInstanceState != null) {
            String last = savedInstanceState.getString("url");
            if (last != null && last.startsWith(ORIGIN + "/assets/")) url = last;
        }
        web.loadUrl(url);
    }

    private void onBridgeMessage(WebMessageCompat message, JavaScriptReplyProxy reply) {
        String raw = message.getData();
        if (raw == null || raw.length() > MAX_SAVE_CHARS + 1024) return;
        try {
            JSONObject m = new JSONObject(raw);
            switch (m.optString("type")) {
                case "save":
                    saveFile(m.optString("name", "export.csv"), m.optString("mime", "text/plain"), m.optString("text", ""), reply);
                    break;
                case "print":
                    print(m.optString("title", getString(R.string.app_name)));
                    break;
                case "share":
                    share(m.optString("title", ""), m.optString("text", ""));
                    break;
                default:
                    break;
            }
        } catch (JSONException ignored) {
            // not a message from our page
        }
    }

    private void saveFile(String name, String mime, String text, JavaScriptReplyProxy reply) {
        String safe = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (safe.length() > 80) safe = safe.substring(safe.length() - 80);
        String type = mime.equals("text/csv") || mime.equals("application/json") ? mime : "text/plain";
        pendingSaveText = text;
        pendingSaveName = safe;
        pendingReply = reply;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(type)
                .putExtra(Intent.EXTRA_TITLE, safe);
        try {
            createFile.launch(i);
        } catch (ActivityNotFoundException e) {
            pendingSaveText = null;
            replySaved(reply, false, safe);
        }
    }

    private void replySaved(JavaScriptReplyProxy reply, boolean ok, String name) {
        if (reply == null) return;
        try {
            reply.postMessage(new JSONObject().put("type", "saved").put("ok", ok).put("name", name == null ? "" : name).toString());
        } catch (JSONException | IllegalStateException ignored) {
            // page is gone
        }
    }

    private void print(String title) {
        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
        if (pm == null) return;
        String job = title.isEmpty() ? getString(R.string.app_name) : title;
        if (job.length() > 80) job = job.substring(0, 80);
        PrintDocumentAdapter adapter = web.createPrintDocumentAdapter(job);
        pm.print(job, adapter, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
    }

    private void share(String title, String text) {
        if (text.isEmpty()) return;
        if (text.length() > MAX_SHARE_CHARS) text = text.substring(0, MAX_SHARE_CHARS);
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_SUBJECT, title)
                .putExtra(Intent.EXTRA_TEXT, text);
        try {
            startActivity(Intent.createChooser(send, title));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app, Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null && web.getUrl() != null) out.putString("url", web.getUrl());
    }

    @Override
    protected void onDestroy() {
        io.shutdown();
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
