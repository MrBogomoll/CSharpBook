package ru.csharpbook.reader;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.io.*;

public final class BookActivity extends Activity {
    private static final int SAVE_PROJECT = 45;
    private WebView web;
    private BookServer server;
    private BookUpdater updater;
    private CloudBridge cloud;
    private String pending, origin;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        pending = state == null ? null : state.getString("project");
        try {
            server = BookServer.acquire(getApplicationContext());
            origin = server.origin();
        } catch (IOException e) {
            android.util.Log.e("CSharpBook","Could not bind the local book server",e);
            new AlertDialog.Builder(this).setMessage("Не удалось открыть локальный учебник. Закрой приложение и открой его ещё раз.")
                .setPositiveButton("Закрыть",(dialog,which) -> finish()).setCancelable(false).show();
            return;
        }
        web = new WebView(this);
        FrameLayout frame = new FrameLayout(this);
        frame.addView(web);
        if (Build.VERSION.SDK_INT >= 35) {
            frame.setOnApplyWindowInsetsListener((view,insets) -> {
                android.graphics.Insets system = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(system.left,system.top,system.right,system.bottom);
                // The WebView already fits inside these system and keyboard insets.
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(frame);
        systemBars();
        WebSettings settings = web.getSettings();
        updater = new BookUpdater(this);
        cloud = new CloudBridge(this, origin);
        String channel = BuildConfig.VERSION_NAME.contains("_b.") ? " SharpwiseBeta/" + BuildConfig.VERSION_NAME : "";
        settings.setUserAgentString(settings.getUserAgentString() + " CSharpBookAndroid/1" + channel);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                if ("csharpbook".equals(uri.getScheme())) {
                    if ("csharpbook://update/start".equals(uri.toString()) && view.getUrl() != null && local(Uri.parse(view.getUrl()))) {
                        if (request.hasGesture()) updater.start();
                        else showUpdate("Нажми «Проверить обновления» в настройках.", false);
                    }
                    return true;
                }
                if (local(uri)) {
                    if (archive(uri) != null) { export(uri); return true; }
                    return false;
                }
                if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); }
                    catch (ActivityNotFoundException e) { toast("Приложение для открытия ссылки не найдено."); }
                }
                return true;
            }
            @Override public void doUpdateVisitedHistory(WebView view,String url,boolean reload) {
                Uri uri=Uri.parse(url);
                if (local(uri) && "exit".equals(uri.getFragment())) view.post(() -> finish());
            }
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon) { cloud.unbind(); }
            @Override public void onPageFinished(WebView view,String url) {
                if (!local(Uri.parse(url))) return;
                // Older app versions registered an offline worker even in the native reader.
                view.evaluateJavascript("if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(async r=>{if(r.length){await Promise.all(r.map(w=>w.unregister()));location.reload()}})}", null);
                updater.status();
                cloud.bind(view, url);
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (!isFinishing()) recreate();
                return true;
            }
        });
        web.setDownloadListener((url,agent,disposition,mime,length) -> export(Uri.parse(url)));
        if (state == null || web.restoreState(state) == null) web.loadUrl(origin + "/");
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (cloud != null) cloud.redirect(intent);
    }
    private void systemBars() {
        boolean light = (getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
            != android.content.res.Configuration.UI_MODE_NIGHT_YES;
        Window w = getWindow();
        int background = light ? 0xfff6f4f9 : 0xff211f2b;
        w.getDecorView().setBackgroundColor(background);
        w.setStatusBarColor(background); w.setNavigationBarColor(background);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController bars = w.getInsetsController();
            int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            if (bars != null) bars.setSystemBarsAppearance(light ? mask : 0, mask);
        } else {
            View decor = w.getDecorView();
            int mask = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            decor.setSystemUiVisibility((decor.getSystemUiVisibility() & ~mask) | (light ? mask : 0));
        }
    }
    @Override public void onConfigurationChanged(android.content.res.Configuration configuration) {
        super.onConfigurationChanged(configuration); systemBars();
    }
    private boolean local(Uri uri) {
        return "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort()==server.getListeningPort();
    }
    private String archive(Uri uri) {
        String path=uri.getPath();
        if (local(uri) && path != null && path.matches("/projects/[A-Za-z0-9_-]+\\.zip")) return path.substring(1);
        return null;
    }
    private void export(Uri uri) {
        String asset=archive(uri);
        if (asset == null) return;
        pending = asset;
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/zip").putExtra(Intent.EXTRA_TITLE,uri.getLastPathSegment());
        try { startActivityForResult(intent,SAVE_PROJECT); }
        catch (ActivityNotFoundException e) { pending=null; toast("Системный выбор места для сохранения недоступен."); }
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if (cloud != null && cloud.activityResult(request,result,data)) return;
        if (request == BookUpdater.INSTALL || request == BookUpdater.PERMISSION) {
            if (updater != null) updater.result(request,result);
            return;
        }
        if (request != SAVE_PROJECT) return;
        String asset=pending; pending=null;
        if (result!=RESULT_OK || data==null || data.getData()==null || asset==null) return;
        Uri destination=data.getData();
        new Thread(() -> {
            try (InputStream input=getAssets().open("www/" + asset); OutputStream output=getContentResolver().openOutputStream(destination,"w")) {
                if (output == null) throw new IOException();
                byte[] bytes = new byte[16384]; int length;
                while ((length=input.read(bytes)) != -1) output.write(bytes,0,length);
            } catch (IOException e) { runOnUiThread(() -> toast("Не удалось сохранить проект.")); return; }
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                new AlertDialog.Builder(this).setMessage("Архив проекта сохранён.")
                    .setNegativeButton("Готово",null).setPositiveButton("Открыть",(dialog,which) -> {
                      try { startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(destination,"application/zip")
                          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); }
                      catch (ActivityNotFoundException e) { toast("Открой архив через приложение для файлов."); }
                    }).show();
            });
        },"book-project-export").start();
    }
    private void toast(String text) { Toast.makeText(this,text,Toast.LENGTH_SHORT).show(); }
    void showUpdate(String message, boolean busy) {
        if (web == null || web.getUrl() == null || !local(Uri.parse(web.getUrl()))) return;
        web.evaluateJavascript("window.dispatchEvent(new CustomEvent('book-native-update',{detail:{busy:" + busy +
            ",message:" + org.json.JSONObject.quote(message) + "}}))", null);
    }
    @Override public void onBackPressed() {
        if (web!=null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putString("project",pending);
        if (web!=null) web.saveState(state);
    }
    @Override protected void onPause() { if (cloud!=null) cloud.pause(); if (web!=null) web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web!=null) web.onResume(); if (cloud!=null) cloud.resume(); }
    @Override protected void onDestroy() {
        if (cloud != null) cloud.close();
        if (web!=null) {
            if (web.getParent() instanceof ViewGroup) ((ViewGroup)web.getParent()).removeView(web);
            web.destroy(); web=null;
        }
        if (server!=null) BookServer.release(server);
        super.onDestroy();
    }
}
