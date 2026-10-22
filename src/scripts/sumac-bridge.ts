import { hotelData, type SumacRoomType } from "../data/hotel";
import { applyServerFxOracle } from "./fx-service";

export interface SumacRoom {
  id: string;
  roomNumber: string;
  floor: number;
  type: SumacRoomType;
  capacity: number;
  baseRate: number; // S/ PEN en Sumac Gestión
  status: "disponible" | "ocupada" | "ucia" | "limpieza" | "mantenimiento" | "bloqueada" | "lista" | "en_mantenimiento";
  notes?: string;
}

export interface RoomTypeAvailability {
  roomType: SumacRoomType;
  webRoomId: string;
  capacity: number;
  availableCount: number;
  totalCount: number;
  nextRoomNumber: string | null;
  availableRoomNumbers: string[];
  suitableForGuests: boolean;
  reasonIfUnavailable?: "aforo_insuficiente" | "agotada_en_sumac" | "api_no_disponible";
}

export interface SumacInventorySnapshot {
  ok: boolean;
  source: "sumac-api" | "unavailable";
  revision: number;
  rooms: SumacRoom[];
  availableRooms: SumacRoom[];
  suitableForGuests: SumacRoom[];
  byRoomType: Record<SumacRoomType, RoomTypeAvailability>;
}

export interface CreateWebReservationInput {
  guestName: string;
  docType: "dni" | "pasaporte" | "ce";
  docNumber: string;
  nationality: string;
  phone: string;
  email: string;
  checkInDate: string;
  checkOutDate: string;
  guestCount: number;
  roomTypeRequested: SumacRoomType;
  assignedRoomNumber?: string;
  totalAmountUsd: number;
  totalAmountPen: number;
  fxRate: number;
  cryptoChain: string;
  cryptoToken: string;
  txHash: string;
  quoteId?: string;
  explorerUrl?: string;
  paymentMode?: string;
  paymentModeLabel: string;
  isRealWalletTx?: boolean;
  specialRequests?: string;
}

export interface SumacQuoteHoldResponse {
  ok: true;
  quoteId: string;
  expiresAt: string;
  expiresAtMs: number;
  assignedRoomNumber: string;
  roomType: SumacRoomType;
  nights: number;
  totalAmountUsd: number;
  totalAmountPen: number;
  treasuryWallet: string;
  chainIdHex: string;
}

export async function createSumacQuoteHold(input: {
  guestName: string;
  docType: "dni" | "pasaporte" | "ce";
  docNumber: string;
  nationality: string;
  checkInDate: string;
  checkOutDate: string;
  guestCount: number;
  roomTypeRequested: SumacRoomType;
  assignedRoomNumber?: string;
}): Promise<SumacQuoteHoldResponse> {
  const baseUrl = getSumacApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/public-booking`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "createQuoteHold",
      ...input
    })
  });
  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || "No se pudo reservar temporalmente la habitación en Sumac Gestión.");
  }
  if (data.fxOracle) {
    applyServerFxOracle(data.fxOracle);
  }
  return data as SumacQuoteHoldResponse;
}

export async function releaseSumacQuoteHold(quoteId: string): Promise<void> {
  if (!quoteId) return;
  const baseUrl = getSumacApiBaseUrl();
  try {
    await fetch(`${baseUrl}/api/public-booking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "releaseQuoteHold",
        quoteId
      })
    });
  } catch {
    // Ignorar error de red al liberar hold
  }
}

export function getSumacApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const configured = (window as any).__SUMAC_API_BASE_URL__;
    if (typeof configured === "string" && configured.trim().length > 0) {
      return configured.trim().replace(/\/+$/, "");
    }
    const host = window.location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1" && window.location.protocol === "https:") {
      return hotelData.sumacApiBaseUrl.startsWith("https://")
        ? hotelData.sumacApiBaseUrl
        : window.location.origin;
    }
    const resolvedHost = !host || host === "localhost" ? "127.0.0.1" : host;
    return `http://${resolvedHost}:3000`;
  }
  return hotelData.sumacApiBaseUrl || "http://127.0.0.1:3000";
}

function buildInventorySnapshot(
  rooms: SumacRoom[],
  availableRooms: SumacRoom[],
  guests: number,
  source: "sumac-api" | "unavailable",
  revision = 0,
  isOk = true
): SumacInventorySnapshot {
  const suitableForGuests = isOk ? availableRooms.filter((r) => r.capacity >= guests) : [];
  const byRoomType = {} as Record<SumacRoomType, RoomTypeAvailability>;

  for (const webRoom of hotelData.rooms) {
    const rType = webRoom.sumacRoomType;
    const allOfType = rooms.filter((r) => r.type === rType);
    const availOfType = isOk ? availableRooms.filter((r) => r.type === rType) : [];
    const capacity = webRoom.capacity;
    const hasCapacity = capacity >= guests;
    const suitable = isOk && hasCapacity && availOfType.length > 0;

    let reasonIfUnavailable: "aforo_insuficiente" | "agotada_en_sumac" | "api_no_disponible" | undefined;
    if (!isOk) {
      reasonIfUnavailable = "api_no_disponible";
    } else if (!hasCapacity) {
      reasonIfUnavailable = "aforo_insuficiente";
    } else if (availOfType.length === 0) {
      reasonIfUnavailable = "agotada_en_sumac";
    }

    byRoomType[rType] = {
      roomType: rType,
      webRoomId: webRoom.id,
      capacity,
      availableCount: availOfType.length,
      totalCount: allOfType.length,
      nextRoomNumber: availOfType[0]?.roomNumber || null,
      availableRoomNumbers: availOfType.map((r) => r.roomNumber),
      suitableForGuests: suitable,
      reasonIfUnavailable
    };
  }

  return {
    ok: isOk,
    source,
    revision,
    rooms,
    availableRooms: isOk ? availableRooms : [],
    suitableForGuests,
    byRoomType
  };
}

export async function fetchSumacInventory(
  checkIn: string,
  checkOut: string,
  guests: number
): Promise<SumacInventorySnapshot> {
  const baseUrl = getSumacApiBaseUrl();
  try {
    const url = new URL(`${baseUrl}/api/public-booking`);
    url.searchParams.set("checkIn", checkIn);
    url.searchParams.set("checkOut", checkOut);
    url.searchParams.set("guests", String(guests));

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store"
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.fxOracle) {
        applyServerFxOracle(data.fxOracle);
      }
      if (data && data.ok && Array.isArray(data.rooms)) {
        return buildInventorySnapshot(
          data.rooms,
          data.availableRooms || [],
          guests,
          "sumac-api",
          data.revision || 1,
          true
        );
      }
    }
  } catch {
    // Si el servidor no está disponible, reportar indisponibilidad real (ok: false) y no inventar habitaciones
  }

  return buildInventorySnapshot([], [], guests, "unavailable", 0, false);
}

export function selectOptimalRoomForGuests(
  guests: number,
  currentRoomId: string,
  snapshot: SumacInventorySnapshot,
  forceMatchByGuests = false
): { selectedRoomId: string; assignedRoomNumber: string | null } {
  const currentWebRoom = hotelData.rooms.find((r) => r.id === currentRoomId);

  if (!snapshot.ok) {
    const byCap =
      hotelData.rooms.find((r) => r.capacity === guests) ||
      hotelData.rooms.find((r) => r.capacity >= guests) ||
      hotelData.rooms[0];
    return {
      selectedRoomId: forceMatchByGuests ? byCap.id : currentWebRoom?.id || byCap.id,
      assignedRoomNumber: null
    };
  }

  if (!forceMatchByGuests && currentWebRoom) {
    const currentAvail = snapshot.byRoomType[currentWebRoom.sumacRoomType];
    if (currentAvail && currentAvail.suitableForGuests) {
      return {
        selectedRoomId: currentWebRoom.id,
        assignedRoomNumber: currentAvail.nextRoomNumber
      };
    }
  }

  const exactCapacityCandidates = hotelData.rooms.filter((r) => {
    const avail = snapshot.byRoomType[r.sumacRoomType];
    return r.capacity === guests && avail && avail.suitableForGuests;
  });

  if (exactCapacityCandidates.length > 0) {
    const keepCurrentExact = exactCapacityCandidates.find((r) => r.id === currentRoomId);
    const chosen = keepCurrentExact || exactCapacityCandidates[0];
    return {
      selectedRoomId: chosen.id,
      assignedRoomNumber: snapshot.byRoomType[chosen.sumacRoomType]?.nextRoomNumber || null
    };
  }

  const upgradeCandidates = hotelData.rooms
    .filter((r) => {
      const avail = snapshot.byRoomType[r.sumacRoomType];
      return r.capacity >= guests && avail && avail.suitableForGuests;
    })
    .sort((a, b) => a.capacity - b.capacity || a.pricePerNight - b.pricePerNight);

  if (upgradeCandidates.length > 0) {
    const chosen = upgradeCandidates[0];
    return {
      selectedRoomId: chosen.id,
      assignedRoomNumber: snapshot.byRoomType[chosen.sumacRoomType]?.nextRoomNumber || null
    };
  }

  const fallbackByCap =
    hotelData.rooms.find((r) => r.capacity >= guests) ||
    hotelData.rooms[hotelData.rooms.length - 1];
  return {
    selectedRoomId: fallbackByCap.id,
    assignedRoomNumber: null
  };
}

export async function createSumacWebReservation(input: CreateWebReservationInput) {
  if (input.isRealWalletTx === false || input.paymentModeLabel.includes("SIMULACIÓN")) {
    throw new Error("Las simulaciones locales no pueden registrar reservas en producción.");
  }

  const baseUrl = getSumacApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/public-booking`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "createWebReservation",
      ...input
    })
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Error al verificar y registrar la reserva en Sumac Gestión");
  }

  if (data.fxOracle) {
    applyServerFxOracle(data.fxOracle);
  }

  return data as {
    ok: true;
    revision: number;
    reservation: {
      id: string;
      code: string;
      guestName: string;
      assignedRoomNumber: string;
      roomTypeRequested: SumacRoomType;
      totalAmount: number;
      channel: string;
      status: string;
      externalReservationId: string;
    };
    assignedRoom: SumacRoom;
    shiftNote: {
      id: string;
      message: string;
    };
  };
}
