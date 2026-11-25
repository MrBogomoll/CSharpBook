using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    internal const int DesktopPort = 53821;
    internal const int PhonePort = 53822;
    internal const string LocalUrl = "http://127.0.0.1:53821";
    private static string[] Addresses() => NetworkInterface.GetAllNetworkInterfaces()
        .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
        .OrderByDescending(n=>n.GetIPProperties().GatewayAddresses.Any(g=>g.Address.AddressFamily==AddressFamily.InterNetwork))
        .SelectMany(n => n.GetIPProperties().UnicastAddresses)
        .Select(a => a.Address).Where(ip => ip.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ip))
        .Select(ip => $"http://{ip}:{PhonePort}/").Distinct().ToArray();

    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var root = Path.GetFullPath(Argument(args, "--root") ?? Path.Combine(AppContext.BaseDirectory, "wwwroot"));
        var serveOnly = args.Contains("--serve-only");
        var port = int.TryParse(Argument(args, "--port"), out var n) ? n : DesktopPort;
        var lan = args.Contains("--lan");
        try
        {
            if (serveOnly) { BookServer.Create(root, port, lan).Run(); return; }
            using var singleton = new Mutex(true, "Local\\CSharpBook.Window.v1", out var first);
            if (!first)
            {
                var windows = Process.GetProcessesByName(Process.GetCurrentProcess().ProcessName);
                foreach (var process in windows)
                    if (process.Id != Environment.ProcessId && process.MainWindowHandle != IntPtr.Zero)
                    {
                        ShowWindow(process.MainWindowHandle, 9);
                        SetForegroundWindow(process.MainWindowHandle);
                        break;
                    }
                return;
            }
            string install = Path.TrimEndingDirectorySeparator(AppContext.BaseDirectory);
            string fingerprint = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(install.ToUpperInvariant())));
            using var installLock = new Mutex(false, @"Local\CSharpBook.Install." + fingerprint);
            try { installLock.WaitOne(); } catch (AbandonedMutexException) { }
            ReleaseUpdate.Recover(install);
            if (!File.Exists(Path.Combine(root, "index.html"))) throw new FileNotFoundException("Рядом с приложением должна быть распакованная папка wwwroot.");
            if (args.Contains("--update-failed")) MessageBox.Show("Не удалось заменить файлы учебника. Предыдущая версия восстановлена.", "Обновление учебника");
            var server = BookServer.Create(root, DesktopPort, false);
            server.StartAsync().GetAwaiter().GetResult();
            try { using var window = new BookWindow(root, lan); Application.Run(window); }
            finally { server.StopAsync(TimeSpan.FromSeconds(2)).GetAwaiter().GetResult(); server.DisposeAsync().AsTask().GetAwaiter().GetResult(); }
        }
        catch (Exception ex)
        {
            if (serveOnly) { Console.Error.WriteLine(ex); Environment.ExitCode = 1; }
            else MessageBox.Show(ex.GetBaseException().Message, "Sharpwise", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);
    private static string? Argument(string[] args,string option) { int i=Array.IndexOf(args,option); return i>=0 && i+1<args.Length ? args[i+1] : null; }

    private sealed class BookWindow : Form
    {
        private readonly WebView2 view = new() {Dock=DockStyle.Fill};
        private readonly string root;
        private readonly CloudSync cloud;
        private WebApplication? phoneServer;
        private bool changing;
        private readonly CancellationTokenSource closing = new();
        private bool updating;
        public BookWindow(string root, bool startLan)
        {
            this.root=root;
            cloud = new CloudSync(this);
            Text="Sharpwise"; Width=1150; Height=850; MinimumSize=new Size(360,450);
            StartPosition=FormStartPosition.CenterScreen; Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            Controls.Add(view);
            Shown+=async (_,_) => {
                try
                {
                    var profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CSharpBook","Browser");
                    var env=await CoreWebView2Environment.CreateAsync(null,profile);
                    await view.EnsureCoreWebView2Async(env);
                    var core=view.CoreWebView2;
                    if (ReleaseUpdate.IsPreview) core.Settings.UserAgent += " SharpwisePreview/1";
                    core.Settings.AreDefaultContextMenusEnabled=true;
                    core.NavigationStarting+=(_,e)=>{if(!Local(e.Uri) && e.Uri!="about:blank"){e.Cancel=true; OpenExternal(e.Uri);}};
                    core.NewWindowRequested+=(_,e)=>{e.Handled=true; OpenExternal(e.Uri);};
                    core.NavigationCompleted+=async (_,e)=>{
                        if(e.IsSuccess && Local(core.Source))
                            await core.ExecuteScriptAsync("if(navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(async r=>{if(r.length){await Promise.all(r.map(w=>w.unregister()));location.reload()}})}");
                    };
                    core.DownloadStarting+=(_,e)=>{
                        var name=Path.GetFileName(e.ResultFilePath);
                        using var picker=new SaveFileDialog { FileName=name, Filter="Архив ZIP (*.zip)|*.zip|Все файлы (*.*)|*.*" };
                        if(picker.ShowDialog(this)==DialogResult.OK) e.ResultFilePath=picker.FileName;
                        else e.Cancel=true;
                        e.Handled=true;
                    };
                    core.WebMessageReceived+=async (_,e)=>{
                        if (!Local(e.Source)) return;
                        string command;
                        try { command=e.TryGetWebMessageAsString(); }
                        catch (ArgumentException) { return; }
                        if (command.StartsWith('{'))
                        {
                            if (new Uri(e.Source).AbsolutePath is not ("/" or "/index.html")) return;
                            var reply = await cloud.Handle(command, closing.Token);
                            if (reply != null && !closing.IsCancellationRequested && Local(core.Source))
                                core.PostWebMessageAsJson(reply);
                            return;
                        }
                        if(command=="close"){Close();return;}
                        if(command=="update-start"){await UpdateBook();return;}
                        if(command=="lan-on"||command=="lan-off") await SetPhoneAccess(command=="lan-on");
                        else if(command=="lan-info") SendPhoneInfo();
                    };
                    if(startLan) await SetPhoneAccess(true);
                    core.Navigate(LocalUrl+"/");
                }
                catch(Exception ex) {MessageBox.Show(this,ex.GetBaseException().Message,"Не удалось открыть окно учебника");Close();}
            };
        }
        private static bool Local(string url) => Uri.TryCreate(url,UriKind.Absolute,out var u) && u.GetLeftPart(UriPartial.Authority)==LocalUrl;
        private bool ConfirmDownload(ReleaseAsset release)
        {
            var download = new TaskDialogButton("Скачать");
            var cancel = new TaskDialogButton("Отмена");
            var culture = System.Globalization.CultureInfo.GetCultureInfo("ru-RU");
            string size = release.Size < 1_000_000
                ? release.Size.ToString("N0", culture) + " Б"
                : (release.Size / 1_000_000d).ToString("0.#", culture) + " МБ";
            string details = $"Sharpwise {release.Version} · {size}";
            if (ReleaseUpdate.IsPreview)
                details += $"\nСтабильный выпуск заменит тестовую сборку {ReleaseUpdate.DisplayVersion}. В более раннем выпуске может быть меньше функций.";
            var question = new TaskDialogPage
            {
                Caption = "Обновление Sharpwise", Heading = "Скачать обновление?", Text = details,
                Buttons = { cancel, download }, DefaultButton = cancel, AllowCancel = true
            };
            return TaskDialog.ShowDialog(this, question) == download;
        }
        private async Task UpdateBook()
        {
            if (updating) return;
            updating = true;
            string? stage = null;
            void Status(string message, bool busy = true)
            {
                if (!closing.IsCancellationRequested)
                    view.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { type="update", message, busy }));
            }
            try
            {
                Status("Проверяем последний выпуск…");
                var release = await ReleaseUpdate.Latest(closing.Token);
                if (closing.IsCancellationRequested) return;
                if (release == null) { Status("У тебя последняя версия.", false); return; }
                Status($"Доступна версия {release.Version}.");
                if (!ConfirmDownload(release))
                {
                    Status("Загрузка отменена.", false); return;
                }
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(closing.Token);
                timeout.CancelAfter(TimeSpan.FromMinutes(10));
                stage = ReleaseUpdate.CreateStage(AppContext.BaseDirectory);
                string zip = Path.Combine(stage, "release.zip");
                Status($"Скачиваем версию {release.Version}…");
                await ReleaseUpdate.Download(release, zip, pct => Status($"Скачиваем версию {release.Version} · {pct}%"), timeout.Token);
                Status("Проверяем файлы перед установкой…");
                string destination = Path.Combine(stage, "new");
                await Task.Run(() => ReleaseUpdate.Extract(zip, destination, release.Version), timeout.Token);
                timeout.Token.ThrowIfCancellationRequested();
                File.Delete(zip);
                ReleaseUpdate.WriteHelper(stage);
                using var helper = ReleaseUpdate.LaunchHelper(stage, recover: false);
                stage = null; // The helper owns the prepared files after launch.
                Status("Перезапускаем учебник…");
                Close();
            }
            catch (Exception ex) { Status("Обновление не завершено. " + ex.GetBaseException().Message, false); }
            finally
            {
                if (stage != null) { try { Directory.Delete(stage, true); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
                updating = false;
            }
        }
        private static void OpenExternal(string url)
        {
            if(Uri.TryCreate(url,UriKind.Absolute,out var uri) && (uri.Scheme=="https"||uri.Scheme=="http"))
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri){UseShellExecute=true});
        }
        private async Task SetPhoneAccess(bool enable)
        {
            if(changing) return;
            changing=true;
            try
            {
                if(enable && phoneServer==null)
                {
                    var server=BookServer.Create(root,PhonePort,true);
                    try { await server.StartAsync(); phoneServer=server; }
                    catch { await server.DisposeAsync(); throw; }
                }
                else if(!enable && phoneServer!=null){await phoneServer.StopAsync(TimeSpan.FromSeconds(2)); await phoneServer.DisposeAsync(); phoneServer=null;}
                SendPhoneInfo();
            }
            catch(Exception ex) { SendPhoneInfo("Не удалось изменить доступ. "+ex.GetBaseException().Message); }
            finally {changing=false;}
        }
        private void SendPhoneInfo(string? error=null) =>
            view.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new{type="phone",enabled=phoneServer!=null,urls=phoneServer!=null?Addresses():Array.Empty<string>(),error}));
        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            closing.Cancel();
            if(phoneServer!=null) {phoneServer.StopAsync(TimeSpan.FromSeconds(2)).GetAwaiter().GetResult(); phoneServer.DisposeAsync().AsTask().GetAwaiter().GetResult();}
            base.OnFormClosed(e);
        }
    }
}

