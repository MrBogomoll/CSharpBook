using System.Net;
using System.Net.Sockets;

var lan = args.Contains("--lan");
var root = Path.Combine(AppContext.BaseDirectory,"wwwroot");
var port = 53821;
if (!Directory.Exists(root)) {
    Console.Error.WriteLine("Распакуйте папку wwwroot рядом с CSharpBook.Server.dll.");
    return 2;
}
var server = BookServer.Create(root,port,lan);
Console.WriteLine($"Учебник C# в браузере: http://127.0.0.1:{port}/");
if (lan)
    foreach (var ip in Dns.GetHostAddresses(Dns.GetHostName()).Where(ip=>ip.AddressFamily==AddressFamily.InterNetwork && !IPAddress.IsLoopback(ip)))
        Console.WriteLine($"В той же сети Wi-Fi: http://{ip}:{port}/");
Console.WriteLine("Чтобы остановить учебник, нажмите Ctrl+C.");
await server.RunAsync();
return 0;
