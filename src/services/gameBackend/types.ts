import type {
  CreateRoomRequest,
  ErrorCode,
  PieceColor,
  PieceSymbol,
  RoomSnapshot,
  ServerMessage,
} from "@shared/protocol";

export interface PlayerIdentity {id: string}

export interface CreateRoomResult {
  snapshot: RoomSnapshot;
  inviteToken: string;
  assignedColor: PieceColor;
}

export interface JoinRoomInput {
  publicCode: string;
  inviteToken?: string;
  displayName: string;
  clientActionId: string;
}

export type RoomAction =
  | {type: "submit_move"; roomId: string; expectedVersion: number; clientActionId: string; from: string; to: string; promotion?: PieceSymbol}
  | {type: "confirm_move_copied"; roomId: string; expectedVersion: number; clientActionId: string; moveSequence: number}
  | {type: "request_undo"; roomId: string; expectedVersion: number; clientActionId: string; targetSequence: number}
  | {type: "respond_to_undo"; roomId: string; expectedVersion: number; clientActionId: string; accepted: boolean}
  | {type: "offer_draw"; roomId: string; expectedVersion: number; clientActionId: string}
  | {type: "respond_to_draw"; roomId: string; expectedVersion: number; clientActionId: string; accepted: boolean}
  | {type: "resign"; roomId: string; expectedVersion: number; clientActionId: string}
  | {type: "leave_room"; roomId: string; expectedVersion: number; clientActionId: string};

export interface ActionResult {snapshot: RoomSnapshot; message?: ServerMessage}

export interface RoomRealtimeEvent {
  protocolVersion: number;
  roomId: string;
  eventId: string;
  version: number;
  moveSequence: number;
  serverTimestamp: string;
  type: string;
  payload: unknown;
}

export interface RoomSubscriptionHandlers {
  onEvent(event: RoomRealtimeEvent): void;
  onStatus(status: "subscribed" | "reconnecting" | "closed"): void;
  onError(error: ApiError): void;
}

export type Unsubscribe = () => Promise<void>;

export interface GameBackend {
  initializeIdentity(): Promise<PlayerIdentity>;
  createRoom(input: CreateRoomRequest & {clientActionId: string}): Promise<CreateRoomResult>;
  joinRoom(input: JoinRoomInput): Promise<RoomSnapshot>;
  getSnapshot(roomId: string): Promise<RoomSnapshot>;
  performAction(action: RoomAction): Promise<ActionResult>;
  subscribeToRoom(roomId: string, handlers: RoomSubscriptionHandlers): Promise<Unsubscribe>;
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly retryable = false,
    readonly status = 500,
  ) {
    super(code);
    this.name = "ApiError";
  }
}
