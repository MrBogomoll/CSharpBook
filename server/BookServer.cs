using System.Net;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;

internal static class BookServer
{
    internal static WebApplication Create(string root, int port, bool lan)
    {
        var options = new WebApplicationOptions { Args=[], ContentRootPath=root, WebRootPath=root };
        var builder=WebApplication.CreateSlimBuilder(options);
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(k => k.Listen(lan ? IPAddress.Any : IPAddress.Loopback, port));
        var app=builder.Build();
        app.Use(async (ctx,next) => {
            ctx.Response.Headers["Cross-Origin-Opener-Policy"]="same-origin";
            ctx.Response.Headers["Cross-Origin-Embedder-Policy"]="require-corp";
            ctx.Response.Headers["Cross-Origin-Resource-Policy"]="same-origin";
            ctx.Response.Headers["X-Content-Type-Options"]="nosniff";
            ctx.Response.Headers["Referrer-Policy"]="no-referrer";
            if (ctx.Request.Path=="/sw.js" || ctx.Request.Path=="/" || ctx.Request.Path=="/index.html") ctx.Response.Headers.CacheControl="no-cache";
            await next();
        });
        var provider=new PhysicalFileProvider(root);
        app.UseDefaultFiles(new DefaultFilesOptions{ FileProvider=provider });
        var types=new FileExtensionContentTypeProvider();
        foreach(var (ext,mime) in new[] {(".wasm","application/wasm"),(".mjs","text/javascript"),(".dll","application/octet-stream"),(".dat","application/octet-stream"),(".bin","application/octet-stream"),(".pdb","application/octet-stream"),(".webmanifest","application/manifest+json"),(".blat","application/octet-stream"),(".br","application/octet-stream")})
            types.Mappings[ext]=mime;
        app.UseStaticFiles(new StaticFileOptions { FileProvider=provider, ContentTypeProvider=types });
        app.MapBookInput();
        return app;
    }
}
