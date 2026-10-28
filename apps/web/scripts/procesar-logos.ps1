# Convierte los JPG de marca (fondo incluido) en PNG transparentes y recortados para la PWA.
#   pwsh apps/web/scripts/procesar-logos.ps1 -Fuente docs/marca -Salida apps/web/src/assets
# Estima la opacidad de cada píxel contra el color de fondo (esquina) y recupera el color de la tinta;
# lo cromático (los puntos turquesa) se conserva aparte de la tinta neutra.
param(
  [string]$Fuente = "docs/marca",
  [string]$Salida = "apps/web/src/assets"
)

Add-Type -ReferencedAssemblies System.Drawing.Common,System.Drawing.Primitives,System.Private.Windows.GdiPlus,System.Private.Windows.Core -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

public static class Logos {
  // modo: "tal-cual" conserva los colores; "claro" pasa la tinta neutra a blanco cálido (para fondo oscuro).
  public static void Procesar(string entrada, string salida, int anchoFinal, string modo) {
    using (var src = new Bitmap(entrada)) {
      int w = src.Width, h = src.Height;
      var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
      using (var g = Graphics.FromImage(bmp)) g.DrawImage(src, 0, 0, w, h);
      var r = new Rectangle(0, 0, w, h);
      var d = bmp.LockBits(r, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      int n = Math.Abs(d.Stride) * h;
      var px = new byte[n];
      Marshal.Copy(d.Scan0, px, 0, n);

      // fondo: mediana aproximada de cuatro esquinas
      double bb = 0, bg = 0, br = 0;
      int[][] puntos = { new[]{20,20}, new[]{w-20,20}, new[]{20,h-20}, new[]{w-20,h-20} };
      foreach (var p in puntos) { int i = p[1]*d.Stride + p[0]*4; bb += px[i]; bg += px[i+1]; br += px[i+2]; }
      bb /= 4; bg /= 4; br /= 4;
      double lumFondo = 0.299*br + 0.587*bg + 0.114*bb;

      int minX = w, minY = h, maxX = 0, maxY = 0;
      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          int i = y*d.Stride + x*4;
          double b = px[i], gg = px[i+1], rr = px[i+2];
          double lum = 0.299*rr + 0.587*gg + 0.114*b;
          double dif = Math.Abs(lum - lumFondo);
          double croma = Math.Max(rr, Math.Max(gg, b)) - Math.Min(rr, Math.Min(gg, b));
          double a = Math.Min(1.0, Math.Max(dif / 150.0, croma / 90.0));
          if (a < 0.10) a = 0;
          bool cromatico = croma > 25;
          double or_, og, ob;
          if (a == 0) { or_ = og = ob = 0; }
          else {
            or_ = (rr - br*(1-a)) / a; og = (gg - bg*(1-a)) / a; ob = (b - bb*(1-a)) / a;
            if (modo == "claro" && !cromatico) { or_ = 253; og = 252; ob = 252; }
            or_ = Math.Max(0, Math.Min(255, or_)); og = Math.Max(0, Math.Min(255, og)); ob = Math.Max(0, Math.Min(255, ob));
          }
          px[i] = (byte)ob; px[i+1] = (byte)og; px[i+2] = (byte)or_; px[i+3] = (byte)Math.Round(a*255);
          if (a > 0.3) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        }
      }
      Marshal.Copy(px, 0, d.Scan0, n);
      bmp.UnlockBits(d);

      int margen = 8;
      minX = Math.Max(0, minX - margen); minY = Math.Max(0, minY - margen);
      maxX = Math.Min(w - 1, maxX + margen); maxY = Math.Min(h - 1, maxY + margen);
      int cw = maxX - minX + 1, ch = maxY - minY + 1;
      int fw = anchoFinal, fh = (int)Math.Round((double)ch * fw / cw);
      using (var fin = new Bitmap(fw, fh, PixelFormat.Format32bppArgb))
      using (var g2 = Graphics.FromImage(fin)) {
        g2.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g2.SmoothingMode = SmoothingMode.HighQuality;
        g2.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g2.Clear(Color.Transparent);
        g2.DrawImage(bmp, new Rectangle(0, 0, fw, fh), new Rectangle(minX, minY, cw, ch), GraphicsUnit.Pixel);
        fin.Save(salida, ImageFormat.Png);
      }
      bmp.Dispose();
    }
  }

  // Icono cuadrado: el símbolo (PNG transparente) centrado sobre un fondo liso; proporcion = ancho del símbolo / lado.
  public static void Icono(string simbolo, string salida, int lado, string fondo, double proporcion, double radio) {
    using (var sim = new Bitmap(simbolo))
    using (var fin = new Bitmap(lado, lado, PixelFormat.Format32bppArgb))
    using (var g = Graphics.FromImage(fin)) {
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;
      g.SmoothingMode = SmoothingMode.HighQuality;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      g.Clear(Color.Transparent);
      var color = ColorTranslator.FromHtml(fondo);
      using (var br = new SolidBrush(color)) {
        if (radio <= 0) g.FillRectangle(br, 0, 0, lado, lado);
        else {
          float d = (float)(lado * radio * 2);
          using (var gp = new GraphicsPath()) {
            gp.AddArc(0, 0, d, d, 180, 90); gp.AddArc(lado - d, 0, d, d, 270, 90);
            gp.AddArc(lado - d, lado - d, d, d, 0, 90); gp.AddArc(0, lado - d, d, d, 90, 90);
            gp.CloseFigure(); g.FillPath(br, gp);
          }
        }
      }
      int w = (int)Math.Round(lado * proporcion), h = (int)Math.Round((double)sim.Height * w / sim.Width);
      g.DrawImage(sim, (lado - w) / 2, (lado - h) / 2, w, h);
      fin.Save(salida, ImageFormat.Png);
    }
  }
}
"@

New-Item -ItemType Directory -Force $Salida | Out-Null
$f = (Resolve-Path $Fuente).Path
$s = (Resolve-Path $Salida).Path
[Logos]::Procesar("$f\logo_positivo_lympha.jpg", "$s\lympha-logo.png", 480, "tal-cual")
[Logos]::Procesar("$f\logo_negativo_lympha.jpg", "$s\lympha-logo-oscuro.png", 480, "tal-cual")
[Logos]::Procesar("$f\logo_sin_letras_lympha.jpg", "$s\lympha-simbolo.png", 320, "tal-cual")
[Logos]::Procesar("$f\logo_sin_letras_lympha.jpg", "$s\lympha-simbolo-oscuro.png", 320, "claro")
# Iconos de la PWA: tinta sobre fondo oscuro (maskable: el símbolo dentro del 80 % central, el SO recorta los bordes).
$p = (Resolve-Path (Join-Path $s "../../public")).Path
$sim = "$s/lympha-simbolo-oscuro.png"
[Logos]::Icono($sim, "$p/icon-512.png", 512, "#0a0c0c", 0.74, 0.0)
[Logos]::Icono($sim, "$p/icon-192.png", 192, "#0a0c0c", 0.74, 0.0)
[Logos]::Icono($sim, "$p/icon-maskable-512.png", 512, "#0a0c0c", 0.56, 0.0)
[Logos]::Icono($sim, "$p/apple-touch-icon.png", 180, "#0a0c0c", 0.70, 0.0)
[Logos]::Icono($sim, "$p/favicon-64.png", 64, "#0a0c0c", 0.84, 0.22)
Get-ChildItem $s -Filter "lympha-*.png" | ForEach-Object { "{0} {1} KB" -f $_.Name, [int]($_.Length/1KB) }
