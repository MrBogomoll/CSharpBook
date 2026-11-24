using System.Security.Cryptography;
using System.Text;
using System.Threading.Channels;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

internal static class InputRoutes
{
    private sealed class Mailbox {
        public string ReadKey { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        public string WriteKey { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        public Channel<string> Lines { get; } = Channel.CreateBounded<string>(16);
        public long LastUse = Environment.TickCount64;
    }

    public static void MapBookInput(this WebApplication app) {
        var sync = new object();
        var read = new Dictionary<string,Mailbox>(StringComparer.Ordinal);
        var write = new Dictionary<string,Mailbox>(StringComparer.Ordinal);
        void Close(Mailbox box) {
            read.Remove(box.ReadKey);
            write.Remove(box.WriteKey);
            box.Lines.Writer.TryComplete();
        }
        static bool FromApp(HttpContext context) =>
            context.Request.Headers["X-Book-Input"] == "1" && (!context.Request.Headers.ContainsKey("Origin") ||
            context.Request.Headers.Origin == $"{context.Request.Scheme}://{context.Request.Host}");
        void Expire() {
            foreach (var box in read.Values.Where(box => Environment.TickCount64 - Interlocked.Read(ref box.LastUse) > 15 * 60_000).ToArray()) Close(box);
        }
        app.MapPost("/api/book-input", (HttpContext context) => {
            if (!FromApp(context)) return Results.StatusCode(403);
            lock(sync) {
                Expire();
                if (read.Count >= 64) return Results.StatusCode(429);
                var box = new Mailbox();
                read.Add(box.ReadKey,box); write.Add(box.WriteKey,box);
                context.Response.Headers.CacheControl = "no-store";
                return Results.Json(new {read=box.ReadKey, write=box.WriteKey});
            }
        });
        app.MapGet("/api/book-input/read/{key}", async (HttpContext context,string key) => {
            context.Response.Headers.AccessControlAllowOrigin = "*";
            context.Response.Headers["Cross-Origin-Resource-Policy"] = "cross-origin";
            context.Response.Headers.CacheControl = "no-store";
            Mailbox? box;
            lock(sync) read.TryGetValue(key,out box);
            if (box is null) return Results.NotFound();
            Interlocked.Exchange(ref box.LastUse,Environment.TickCount64);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            timeout.CancelAfter(TimeSpan.FromMinutes(1));
            try { return Results.Text(await box.Lines.Reader.ReadAsync(timeout.Token),"text/plain",Encoding.UTF8); }
            catch (OperationCanceledException) { return Results.NoContent(); }
            catch (ChannelClosedException) { return Results.StatusCode(410); }
        });
        app.MapPost("/api/book-input/write/{key}", async (HttpContext context,string key) => {
            if (!FromApp(context)) return Results.StatusCode(403);
            Mailbox? box;
            lock(sync) write.TryGetValue(key,out box);
            if (box is null) return Results.NotFound();
            if (context.Request.ContentLength is null || context.Request.ContentLength > 65536) return Results.StatusCode(413);
            using var stream = new StreamReader(context.Request.Body, Encoding.UTF8);
            var line = await stream.ReadToEndAsync(context.RequestAborted);
            Interlocked.Exchange(ref box.LastUse,Environment.TickCount64);
            return box.Lines.Writer.TryWrite(line) ? Results.NoContent() : Results.StatusCode(429);
        });
        app.MapDelete("/api/book-input/write/{key}", (HttpContext context,string key) => {
            if (!FromApp(context)) return Results.StatusCode(403);
            lock(sync) if (write.TryGetValue(key,out var box)) Close(box);
            return Results.NoContent();
        });
    }
}
