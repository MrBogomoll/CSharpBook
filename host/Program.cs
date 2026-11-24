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
            if (!File.Exists(Path.Combine(root, "index.html"))) throw new FileNotFoundException("Рядом с приложением должна быть распакованная папка wwwroot.");
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
            var server = BookServer.Create(root, DesktopPort, false);
            server.StartAsync().GetAwaiter().GetResult();
            try { using var window = new BookWindow(root, lan); Application.Run(window); }
            finally { server.StopAsync(TimeSpan.FromSeconds(2)).GetAwaiter().GetResult(); server.DisposeAsync().AsTask().GetAwaiter().GetResult(); }
        }
        catch (Exception ex)
        {
            if (serveOnly) { Console.Error.WriteLine(ex); Environment.ExitCode = 1; }
            else MessageBox.Show(ex.GetBaseException().Message, "Учебник C#", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);
    private static string? Argument(string[] args,string option) { int i=Array.IndexOf(args,option); return i>=0 && i+1<args.Length ? args[i+1] : null; }

    private sealed class BookWindow : Form
    {
        private readonly WebView2 view = new() {Dock=DockStyle.Fill};
        private readonly string root;
        private WebApplication? phoneServer;
        private bool changing;
        public BookWindow(string root, bool startLan)
        {
            this.root=root;
            Text="Учебник C#"; Width=1150; Height=850; MinimumSize=new Size(360,450);
            StartPosition=FormStartPosition.CenterScreen; Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            Controls.Add(view);
            Shown+=async (_,_) => {
                try
                {
                    var profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CSharpBook","Browser");
                    var env=await CoreWebView2Environment.CreateAsync(null,profile);
                    await view.EnsureCoreWebView2Async(env);
                    var core=view.CoreWebView2;
                    core.Settings.AreDefaultContextMenusEnabled=true;
                    core.NavigationStarting+=(_,e)=>{if(!Local(e.Uri) && e.Uri!="about:blank"){e.Cancel=true; OpenExternal(e.Uri);}};
                    core.NewWindowRequested+=(_,e)=>{e.Handled=true; OpenExternal(e.Uri);};
                    core.DownloadStarting+=(_,e)=>{
                        var name=Path.GetFileName(e.ResultFilePath);
                        using var picker=new SaveFileDialog { FileName=name, Filter="Архив ZIP (*.zip)|*.zip|Все файлы (*.*)|*.*" };
                        if(picker.ShowDialog(this)==DialogResult.OK) e.ResultFilePath=picker.FileName;
                        else e.Cancel=true;
                        e.Handled=true;
                    };
                    core.WebMessageReceived+=async (_,e)=>{
                        if (!Local(e.Source)) return;
                        var command=e.TryGetWebMessageAsString();
                        if(command=="close"){Close();return;}
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
            if(phoneServer!=null) {phoneServer.StopAsync(TimeSpan.FromSeconds(2)).GetAwaiter().GetResult(); phoneServer.DisposeAsync().AsTask().GetAwaiter().GetResult();}
            base.OnFormClosed(e);
        }
    }
}

