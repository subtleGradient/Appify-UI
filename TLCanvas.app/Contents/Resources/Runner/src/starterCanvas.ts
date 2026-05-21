import {
  createShapeId,
  createTLStore,
  toRichText,
  type TLDefaultColorStyle,
  type TLGeoShape,
  type TLStoreSnapshot,
} from "tldraw";
import type { CanvasStatePayload } from "./canvasApi";

const STARTER_PAGE_ID = "page:page";

interface StarterCard {
  id: string;
  index: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: TLDefaultColorStyle;
  text: string;
}

const STARTER_CARDS: StarterCard[] = [
  {
    id: "start-here",
    index: "a1",
    x: -390,
    y: -240,
    w: 280,
    h: 112,
    color: "blue",
    text: "Start here",
  },
  {
    id: "make",
    index: "a2",
    x: -55,
    y: -240,
    w: 280,
    h: 112,
    color: "green",
    text: "What are we making?",
  },
  {
    id: "visible",
    index: "a3",
    x: 280,
    y: -240,
    w: 280,
    h: 112,
    color: "yellow",
    text: "What needs to be visible?",
  },
  {
    id: "known",
    index: "a4",
    x: -390,
    y: -60,
    w: 280,
    h: 112,
    color: "light-green",
    text: "What do we know?",
  },
  {
    id: "uncertain",
    index: "a5",
    x: -55,
    y: -60,
    w: 280,
    h: 112,
    color: "orange",
    text: "What is uncertain?",
  },
  {
    id: "next",
    index: "a6",
    x: 280,
    y: -60,
    w: 280,
    h: 112,
    color: "violet",
    text: "Next move",
  },
];

function createStarterShape(card: StarterCard): TLGeoShape {
  return {
    id: createShapeId(`getting-started-${card.id}`),
    typeName: "shape",
    type: "geo",
    parentId: STARTER_PAGE_ID,
    index: card.index,
    x: card.x,
    y: card.y,
    rotation: 0,
    isLocked: false,
    opacity: 1,
    meta: {
      starterCanvas: true,
    },
    props: {
      w: card.w,
      h: card.h,
      geo: "rectangle",
      dash: "draw",
      growY: 0,
      url: "",
      scale: 1,
      color: card.color,
      labelColor: "black",
      fill: "semi",
      size: "m",
      font: "draw",
      align: "middle",
      verticalAlign: "middle",
      richText: toRichText(card.text),
    },
  };
}

export function createStarterCanvasSnapshot(): TLStoreSnapshot {
  const snapshot = createTLStore().getStoreSnapshot("document");
  const starterShapes = STARTER_CARDS.map(createStarterShape);

  return createTLStore({
    snapshot: {
      ...snapshot,
      store: {
        ...snapshot.store,
        ...Object.fromEntries(starterShapes.map((shape) => [shape.id, shape])),
      },
    },
  }).getStoreSnapshot("document");
}

export function createStarterCanvasState(): CanvasStatePayload {
  return {
    revision: 0,
    snapshot: createStarterCanvasSnapshot(),
  };
}
