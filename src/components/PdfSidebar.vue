<script setup lang="ts">
/**
 * サイドバー（chrome）— design.md「UI → PdfSidebar / PdfThumbnail」/
 * 要件 5.1, 5.2, 5.5。
 *
 * `VNavigationDrawer` 内に「アウトライン」「サムネイル」の 2 タブを持ち、
 * - アウトライン: ドキュメント確定時に `usePdfOutline().load(doc)` で木を取得し、
 *   タイトル階層を再帰リスト（このコンポーネント自身を再帰利用）で表示する。
 *   `pageIndex` が非 null のノードを選択すると `store.requestGoToPage`（要件 5.2）。
 *   木が空（しおり無し）のときはアウトラインタブ自体を出さず、サムネイルのみを
 *   既定表示にする（要件 5.5）。
 * - サムネイル: `PdfThumbnail`（task 4.5）をそのまま内包（要件 5.3, 5.4 は同部品）。
 *
 * 境界規約（steering tech.md / structure.md）: これは chrome。Vuetify を用いてよいが
 * `pdfjs-dist` を直接 import しない。pdfjs へはストア状態（markRaw 済み doc）と
 * composable `usePdfOutline` 経由でのみ到達する。doc は markRaw 済みなので
 * リアクティブプロキシ化されず、そのまま composable に渡せる。
 *
 * オーケストレーション（status 出し分け = 要件 5.1 のビューア統合）は task 5.1 の
 * PdfViewer の領分。ここはアウトライン/サムネイルの提示のみを担う。
 */
import { computed, nextTick, ref, toRaw, watch } from 'vue'

import PdfThumbnail from '@/components/PdfThumbnail.vue'
import type { OutlineNode } from '@/composables/usePdfOutline'
import { usePdfOutline } from '@/composables/usePdfOutline'
import type { PDFDocumentProxy } from '@/lib/pdf/pdfjs'
import { usePdfStore } from '@/stores/pdfStore'

/**
 * 再帰利用のための自己参照名。`<script setup>` は既定でファイル名を name に用いる
 * が、テンプレート内で自分自身を参照するために明示の name を与える。
 */
defineOptions({ name: 'PdfSidebar' })

const props = withDefaults(
  defineProps<{
    /**
     * 再帰描画用の木（このコンポーネントが子に渡す）。ルートマウントでは未指定で、
     * doc から `usePdfOutline().load` で取得した木を内部 ref から描画する。
     */
    nodes?: OutlineNode[] | null
    /** 再帰の深さ（インデント用）。ルートは 0。 */
    depth?: number
    /**
     * 強調対象のページ番号（1-origin）。ルートが現在ページから算出し、再帰子へ伝播する
     * （要件 5.7）。一致する `pageIndex` のノードを視覚強調する。
     */
    activePageIndex?: number | null
  }>(),
  { nodes: null, depth: 0, activePageIndex: null },
)

const store = usePdfStore()
const outline = usePdfOutline()

/** タブ選択（'outline' | 'thumbnails'）。 */
const tab = ref<'outline' | 'thumbnails'>('outline')

/**
 * ドロワーの開閉モデル（要件 5.9）。初期は閉。`permanent` を使わず v-model 制御に
 * することで、本文（PdfViewport）が先に表示され、アウトライン/サムネイル準備が
 * 整った後にレイアウトドロワーとしてスライドインさせる（overlay にはしない）。
 */
const drawerOpen = ref(false)

/** ルートで保持するアウトライン木（doc 確定時に load した結果）。 */
const outlineTree = ref<OutlineNode[]>([])
/** load 完了フラグ（未完了時に判定を確定させないため）。 */
const outlineLoaded = ref(false)

/**
 * アウトラインを表示するか（要件 5.5）。load 済みかつ木が非空のときのみ true。
 * false（しおり無し）のときはアウトラインタブを出さず、サムネイルのみ表示する。
 */
const hasOutline = computed(
  () => outlineLoaded.value && outlineTree.value.length > 0,
)

/** ルート描画かどうか（props.nodes 未指定 = ルート）。 */
const isRoot = props.nodes === null

/** 実際に描画する木: ルートは内部 ref、再帰子は props 経由。 */
function currentNodes(): OutlineNode[] {
  return isRoot ? outlineTree.value : (props.nodes ?? [])
}

/** 木を再帰走査し、非 null の `pageIndex` を全て集める。 */
function collectPageIndexes(nodes: OutlineNode[], acc: number[]): void {
  for (const node of nodes) {
    if (node.pageIndex !== null) acc.push(node.pageIndex)
    if (node.children.length > 0) collectPageIndexes(node.children, acc)
  }
}

/**
 * 現在ページに対応する強調対象の `pageIndex`（要件 5.7）。
 * 「`pageIndex` が `currentPage` 以下で最大」＝現在ページを含むしおりを選ぶ。
 * 該当なし（先頭しおりより前など）は null。ルートでのみ算出し、再帰子へは props で渡す。
 * この値の変化を契機に、要件 5.8 の自動スクロールを行う（下記 watch）。
 */
const activePageIndex = computed<number | null>(() => {
  if (!isRoot) return props.activePageIndex
  const current = store.currentPage
  const indexes: number[] = []
  collectPageIndexes(outlineTree.value, indexes)
  let best: number | null = null
  for (const p of indexes) {
    if (p <= current && (best === null || p > best)) best = p
  }
  return best
})

/** ノードが現在ページ強調の対象か（要件 5.7）。 */
function isCurrent(node: OutlineNode): boolean {
  return node.pageIndex !== null && node.pageIndex === activePageIndex.value
}

/** アウトライン木のルート DOM。強調行のスクロール対象探索に使う（ルートのみ）。 */
const outlineRoot = ref<HTMLElement | null>(null)

/**
 * 強調行のアウトライン自動スクロール（要件 5.8）。強調が変化したら DOM 反映後に、
 * 最後の `is-current` 要素を `scrollIntoView({ block: 'nearest' })` で可視にする。
 * 5.6 によりウィンドウは非スクロールなので、実際に動くのは `.pdf-sidebar-pane`
 * （overflow-y:auto）内のみで、本文表示は動かない。ルートのみ実行。
 */
if (isRoot) {
  watch(activePageIndex, async () => {
    await nextTick()
    const el = outlineRoot.value
    if (el === null) return
    const currents = el.querySelectorAll('.pdf-outline-node.is-current')
    const last = currents.item(currents.length - 1)
    // scrollIntoView は実ブラウザに存在。jsdom 等では未実装なので存在を確認する。
    if (last instanceof HTMLElement && typeof last.scrollIntoView === 'function') {
      last.scrollIntoView({ block: 'nearest' })
    }
  })
}

/** doc が差し替わったらアウトラインを再取得する（ルートのみ）。 */
async function reloadOutline(): Promise<void> {
  // (再)読み込み開始時はドロワーを閉じる（要件 5.9）。新しいドキュメントでは
  // まず本文を見せ、準備が整ってからスライドインさせるため、ここで一旦閉じる。
  drawerOpen.value = false
  const doc = store.doc
  if (doc === null) {
    outlineTree.value = []
    outlineLoaded.value = false
    return
  }
  outlineLoaded.value = false
  // doc は markRaw 済み（store）。toRaw で生のオブジェクトに戻して composable に
  // 渡す（PdfThumbnail/PdfViewport と同じ規律：pdfjs オブジェクトをリアクティブ
  // プロキシのまま渡さない）。ストアの ref アンラップ型は pdfjs 内部クラスの
  // `#private` ブランドを失い PDFDocumentProxy へ構造的に代入できないため、生に
  // 戻したうえで境界型へ明示キャストする（実体は本物の proxy）。
  const rawDoc = toRaw(doc) as unknown as PDFDocumentProxy
  const tree = await outline.load(rawDoc)
  outlineTree.value = tree
  outlineLoaded.value = true
  // しおりが有ればアウトラインを、無ければサムネイルを既定タブにする（要件 5.5）。
  tab.value = tree.length > 0 ? 'outline' : 'thumbnails'
  // 準備完了後にドロワーをスライドイン（要件 5.9）。model-value が true に
  // 変わると Vuetify がスライドアニメーションを行う。
  await nextTick()
  drawerOpen.value = true
}

if (isRoot) {
  watch(
    () => store.doc,
    () => {
      void reloadOutline()
    },
    { immediate: true },
  )
}

/**
 * ノード選択。移動先（pageIndex, 1-origin）があればジャンプ要求（要件 5.2）。
 * pageIndex が null の見出しノードは非ナビゲーション。
 */
function selectNode(node: OutlineNode): void {
  if (node.pageIndex !== null) {
    store.requestGoToPage(node.pageIndex)
  }
}
</script>

<template>
  <!--
    再帰子の描画（props.nodes が渡されている場合）: タブ/ドロワー枠は出さず、
    ノードリストのみを描画する。
  -->
  <ul v-if="!isRoot" class="pdf-outline-list" :data-depth="depth">
    <li v-for="(node, i) in currentNodes()" :key="i" class="pdf-outline-item">
      <div
        class="pdf-outline-node"
        data-test="outline-node"
        :class="{
          'is-navigable': node.pageIndex !== null,
          'is-current': isCurrent(node),
        }"
        :style="{ paddingInlineStart: `${(depth ?? 0) * 16 + 8}px` }"
        :aria-current="isCurrent(node) ? 'true' : undefined"
        role="button"
        tabindex="0"
        @click="selectNode(node)"
        @keydown.enter="selectNode(node)"
        @keydown.space.prevent="selectNode(node)"
      >
        {{ node.title }}
      </div>
      <PdfSidebar
        v-if="node.children.length > 0"
        :nodes="node.children"
        :depth="(depth ?? 0) + 1"
        :active-page-index="activePageIndex"
      />
    </li>
  </ul>

  <!-- ルート描画: ドロワー枠 + タブ + 各セクション。 -->
  <v-navigation-drawer
    v-else
    v-model="drawerOpen"
    class="pdf-sidebar"
    data-test="pdf-sidebar"
    width="280"
  >
    <v-tabs v-model="tab" grow density="compact">
      <!-- しおりが有るときだけアウトラインタブを出す（要件 5.5）。 -->
      <v-tab v-if="hasOutline" value="outline" data-test="tab-outline"
        >アウトライン</v-tab
      >
      <v-tab value="thumbnails" data-test="tab-thumbnails">サムネイル</v-tab>
    </v-tabs>

    <v-window v-model="tab" class="pdf-sidebar-window">
      <v-window-item
        v-if="hasOutline"
        value="outline"
        class="pdf-sidebar-pane"
      >
        <div ref="outlineRoot">
          <PdfSidebar
            :nodes="outlineTree"
            :depth="0"
            :active-page-index="activePageIndex"
          />
        </div>
      </v-window-item>

      <v-window-item value="thumbnails" class="pdf-sidebar-pane">
        <PdfThumbnail data-test="sidebar-thumbnails" />
      </v-window-item>
    </v-window>
  </v-navigation-drawer>
</template>

<style scoped>
.pdf-sidebar-window {
  height: calc(100% - 48px);
}
.pdf-sidebar-pane {
  height: 100%;
  overflow-y: auto;
}
.pdf-outline-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.pdf-outline-item {
  margin: 0;
}
.pdf-outline-node {
  padding-block: 6px;
  padding-inline-end: 8px;
  font-size: 14px;
  line-height: 1.3;
  cursor: default;
  user-select: none;
  border-radius: 4px;
}
.pdf-outline-node.is-navigable {
  cursor: pointer;
}
.pdf-outline-node.is-navigable:hover {
  background-color: rgba(25, 118, 210, 0.08);
}
/* 現在ページに対応するしおりの視覚強調（要件 5.7）。自動スクロールは要件 5.8 の watch で行う。 */
.pdf-outline-node.is-current {
  background-color: rgba(25, 118, 210, 0.16);
  font-weight: 600;
}
</style>
