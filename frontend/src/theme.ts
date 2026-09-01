/**
 * 颜色只在 styles.css 的 :root 里定义一次。
 *
 * SVG 的 fill/stroke 和少数内联样式没法写 class，只能拿到具体的值——
 * 那也让它们指回同一批 CSS 变量，别在组件里再抄一遍色号。
 * 换主题时改 :root 就够了，这个文件不用动。
 */
export const color = {
  gray0: 'var(--gray-0)',
  gray1: 'var(--gray-1)',
  gray2: 'var(--gray-2)',
  gray3: 'var(--gray-3)',
  gray4: 'var(--gray-4)',
  gray5: 'var(--gray-5)',
  gray6: 'var(--gray-6)',
  gray7: 'var(--gray-7)',
  gray8: 'var(--gray-8)',
  gray12: 'var(--gray-12)',

  text: 'var(--text)',
  textDim: 'var(--text-dim)',
  textFaint: 'var(--text-faint)',
  accent: 'var(--accent)',
  accentBright: 'var(--accent-bright)',

  tierGreat: 'var(--tier-great)',
  tierSuccess: 'var(--tier-success)',
  tierBarely: 'var(--tier-barely)',
  tierFail: 'var(--tier-fail)',
} as const
