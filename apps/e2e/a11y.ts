import { expect, type Page } from "@playwright/test";

export interface ContrastFailure {
  text: string;
  tag: string;
  ratio: number;
  required: number;
  fg: string;
  bg: string;
}

// Mede o contraste de verdade, no navegador (WCAG 1.4.3 para texto, 1.4.11 para a borda dos campos de formulário).
// As cores do Tailwind v4 são oklch(); o canvas converte qualquer cor CSS para sRGB, e o fundo efetivo vem de compor
// as camadas de fundo de baixo para cima. A opacidade herdada entra na cor do texto.
// Fora da medição: texto desabilitado (exceção do WCAG) e texto escondido visualmente (sr-only). NÃO medido: pseudo-elementos
// (::before, ::after, ::placeholder), ícones e SVG, e a transição entre estados (foco, hover). Um fundo com imagem ou
// gradiente faz a medição falhar em voz alta, em vez de calcular contra um fundo que não é o real.
export function measureContrast(page: Page): Promise<ContrastFailure[]> {
  return page.evaluate(() => {
    type Rgba = [number, number, number, number];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("canvas indisponível");
    const toRgba = (color: string): Rgba => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "#000";
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, (data[3] ?? 0) / 255];
    };
    const over = (top: Rgba, bottom: [number, number, number]): [number, number, number] => [0, 1, 2].map((i) => Math.round((top[i] ?? 0) * top[3] + (bottom[i] ?? 0) * (1 - top[3]))) as [number, number, number];
    const luminance = ([r, g, b]: [number, number, number]) => {
      const lin = (value: number) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: [number, number, number], b: [number, number, number]) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
    };
    const backgroundOf = (element: Element): [number, number, number] => {
      const layers: Rgba[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.backgroundImage !== "none") throw new Error(`contraste: <${node.tagName.toLowerCase()}> tem fundo com imagem ou gradiente; meça à mão`);
        const layer = toRgba(style.backgroundColor);
        if (layer[3] > 0) layers.push(layer);
        if (layer[3] === 1) break;
      }
      return layers.reduceRight<[number, number, number]>((below, layer) => over(layer, below), [255, 255, 255]);
    };
    const hex = (rgb: [number, number, number]) => `rgb(${rgb.join(",")})`;
    const effectiveOpacity = (element: Element) => {
      let value = 1;
      for (let node: Element | null = element; node; node = node.parentElement) value *= Number(getComputedStyle(node).opacity);
      return value;
    };
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 2 && rect.height >= 2 && style.visibility !== "hidden" && style.display !== "none" && effectiveOpacity(element) > 0;
    };
    const failures: { text: string; tag: string; ratio: number; required: number; fg: string; bg: string }[] = [];
    const record = (element: Element, text: string, fg: [number, number, number], bg: [number, number, number], required: number) => {
      const value = ratio(fg, bg);
      if (value < required) failures.push({ text: text.slice(0, 40), tag: element.tagName.toLowerCase(), ratio: Math.round(value * 100) / 100, required, fg: hex(fg), bg: hex(bg) });
    };

    for (const element of document.querySelectorAll("body *")) {
      if (["SCRIPT", "STYLE"].includes(element.tagName) || !visible(element) || element.closest(":disabled, [aria-disabled=true]")) continue;
      const own = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? "").join("").trim();
      const style = getComputedStyle(element);
      if (own) {
        const bg = backgroundOf(element);
        const color = toRgba(style.color);
        color[3] *= effectiveOpacity(element);
        const size = parseFloat(style.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
        record(element, own, over(color, bg), bg, large ? 3 : 4.5);
      }
      if (["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName)) {
        const bg = backgroundOf(element);
        const color = toRgba(style.color);
        color[3] *= effectiveOpacity(element);
        record(element, `texto digitado em <${element.tagName.toLowerCase()}>`, over(color, bg), bg, 4.5);
      }
      if (["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName) && (element as HTMLInputElement).type !== "checkbox" && (element as HTMLInputElement).type !== "radio") {
        const parent = element.parentElement ?? element;
        record(element, `borda de <${element.tagName.toLowerCase()}>`, over(toRgba(style.borderTopColor), backgroundOf(parent)), backgroundOf(parent), 3);
      }
    }
    return failures;
  });
}

// WCAG 1.4.10: em 320 px de largura (o equivalente a 400% de zoom) a página não pode rolar na horizontal.
// Uma tabela larga pode rolar dentro de um contêiner próprio, mas não a página inteira.
export async function expectReflow(page: Page, label: string) {
  const original = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.setViewportSize({ width: 320, height: 640 });
  const { overflow, masked } = await page.evaluate(() => {
    const clipped = (element: Element) => ["hidden", "clip"].includes(getComputedStyle(element).overflowX);
    return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, masked: clipped(document.documentElement) || clipped(document.body) };
  });
  await page.setViewportSize(original);
  // overflow-x: hidden na raiz esconderia o estouro em vez de resolvê-lo.
  expect(masked, `${label}: overflow-x escondido na raiz mascara o reflow`).toBe(false);
  expect(overflow, `${label}: a página rola ${overflow}px na horizontal em 320 px`).toBeLessThanOrEqual(0);
}

export async function expectContrast(page: Page, label: string) {
  const failures = await measureContrast(page);
  expect(failures, `${label}: contraste abaixo do mínimo WCAG AA`).toEqual([]);
}
