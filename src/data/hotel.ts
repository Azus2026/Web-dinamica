export type SumacRoomType = "simple" | "matrimonial" | "doble" | "triple" | "suite_familiar";

export interface RoomOption {
  id: string;
  name: string;
  sumacType: SumacRoomType;
  sumacRoomType: SumacRoomType;
  sumacLabel: string;
  capacity: number;
  minGuests: number;
  maxGuests: number;
  size: string;
  bed: string;
  pricePerNight: number; // En $ USD
  features: string[];
}

export interface WorldStop {
  id: string;
  still: string;
  scrollWeight: number;
  mobileObjectPosition: string;
  stepNumber: string;
  tag: string;
  title: string;
  description: string;
  highlights?: { label: string; value: string }[];
  secondaryCta?: { label: string; href: string };
  showInlineBooking?: boolean;
  showRoomSelector?: boolean;
}

export const hotelData = {
  name: "NOMAD ARCH",
  tagline: "Hospitalidad arquitectónica y refugio contemporáneo",
  bookingBaseUrl: "https://booking.nomadarch-hotel.com/reserve",
  sumacApiBaseUrl: "http://127.0.0.1:3000",
  contact: {
    address: "Passeig de Gràcia 114, 08008 Barcelona",
    phone: "+34 938 00 11 22",
    instagram: "@nomadarch.hotel",
    checkInTime: "15:00",
    checkOutTime: "12:00"
  },
  rooms: [
    {
      id: "atelier-simple",
      name: "Solo Sanctuary Simple",
      sumacType: "simple",
      sumacRoomType: "simple",
      sumacLabel: "Simple (1 pers.)",
      capacity: 1,
      minGuests: 1,
      maxGuests: 1,
      size: "28 m²",
      bed: "Cama Queen 1,60 m",
      pricePerNight: 140,
      features: [
        "Escritorio monolítico en nogal",
        "Ducha lluvia en travertino",
        "Insonorización acústica total"
      ]
    },
    {
      id: "atelier-king",
      name: "Atelier King Suite",
      sumacType: "matrimonial",
      sumacRoomType: "matrimonial",
      sumacLabel: "Matrimonial (1–2 pers.)",
      capacity: 2,
      minGuests: 1,
      maxGuests: 2,
      size: "42 m²",
      bed: "Cama Emperor 2×2 m",
      pricePerNight: 260,
      features: [
        "Lencería de algodón egipcio 600 hilos",
        "Ducha lluvia en piedra travertino",
        "Insonorización acústica total"
      ]
    },
    {
      id: "nomad-doble",
      name: "Nomad Arch Twin Doble",
      sumacType: "doble",
      sumacRoomType: "doble",
      sumacLabel: "Doble (2 pers.)",
      capacity: 2,
      minGuests: 2,
      maxGuests: 2,
      size: "46 m²",
      bed: "2 Camas King 1,50 m",
      pricePerNight: 290,
      features: [
        "Doble tocador en piedra caliza",
        "Zona de lectura con luz cálida",
        "Desayuno de mercado incluido"
      ]
    },
    {
      id: "arch-triple",
      name: "Arch Loft Triple",
      sumacType: "triple",
      sumacRoomType: "triple",
      sumacLabel: "Triple (3 pers.)",
      capacity: 3,
      minGuests: 3,
      maxGuests: 3,
      size: "54 m²",
      bed: "Emperor 2×2 m + Daybed 1,20 m",
      pricePerNight: 340,
      features: [
        "Salón en arco independiente",
        "Capacidad cómoda para 3 adultos",
        "Desayuno gastronómico incluido"
      ]
    },
    {
      id: "grand-arch-suite",
      name: "Grand Arch Suite + Terraza",
      sumacType: "suite_familiar",
      sumacRoomType: "suite_familiar",
      sumacLabel: "Suite Familiar (3–4 pers.)",
      capacity: 4,
      minGuests: 2,
      maxGuests: 4,
      size: "64 m²",
      bed: "2×2 m + Alcoba Privada",
      pricePerNight: 390,
      features: [
        "Terraza privada con vistas al jardín",
        "Bañera exenta tallada en bloque",
        "Desayuno gastronómico incluido"
      ]
    }
  ] as RoomOption[],
  scrollWorld: {
    crossfade: 0.07,
    connScroll: 1.4,
    connectors: [
      "/video/clip-1.mp4",
      "/video/clip-2.mp4",
      "/video/clip-3.mp4",
      "/video/clip-4.mp4"
    ],
    connectorsMobile: [
      "/video/clip-1-mobile.mp4",
      "/video/clip-2-mobile.mp4",
      "/video/clip-3-mobile.mp4",
      "/video/clip-4-mobile.mp4"
    ],
    sections: [
      {
        id: "recepcion",
        still: "/world/stop-0-recepcion.webp",
        scrollWeight: 1.25,
        mobileObjectPosition: "40% center",
        stepNumber: "01",
        tag: "Llegada · Recepción Privada",
        title: "El silencio de la piedra, la calidez del hogar",
        description: "Cruza el umbral hacia un santuario donde la arquitectura mediterránea dialoga con el diseño contemporáneo. Sin prisas, sin mostradores fríos: tu estancia empieza con calma.",
        showInlineBooking: true
      },
      {
        id: "comunidad",
        still: "/world/stop-1-mapa.webp",
        scrollWeight: 0.95,
        mobileObjectPosition: "50% center",
        stepNumber: "02",
        tag: "El Salón · Cartografía Viva",
        title: "Un mural de 5×6 metros que conecta el mundo",
        description: "En el corazón de nuestra sala de estar se alza un mapa mundi artesanal de 30 m² en latón envejecido y nogal. Cada punto de luz cálida representa el origen de un viajero que dejó su huella aquí.",
        highlights: [
          { label: "Dimensiones de la obra", value: "5 × 6 m" },
          { label: "Ciudades conectadas", value: "+1.420" },
          { label: "Altura de bóveda", value: "6,5 m" }
        ]
      },
      {
        id: "restaurante",
        still: "/world/stop-2-restaurante.webp",
        scrollWeight: 0.95,
        mobileObjectPosition: "55% center",
        stepNumber: "03",
        tag: "Gastronomía · Fuego y Origen",
        title: "Alta cocina de producto bajo luz ámbar",
        description: "Un comedor íntimo concebido para alargar la sobremesa. Desayunos de mercado al despertar y cenas a la brasa por la noche, abiertas tanto a nuestros huéspedes como a la ciudad.",
        highlights: [
          { label: "Desayuno tardío", value: "07:30 – 11:30" },
          { label: "Servicio de cena", value: "19:30 – 23:30" }
        ],
        secondaryCta: { label: "Reservar mesa en el restaurante", href: "#experiencias" }
      },
      {
        id: "bar",
        still: "/world/stop-3-bar.webp",
        scrollWeight: 0.95,
        mobileObjectPosition: "50% center",
        stepNumber: "04",
        tag: "Coctelería de Autor · Speakeasy",
        title: "La penumbra perfecta para la última copa",
        description: "Frente a nuestra barra monolítica de piedra estriada y su bóveda iluminada de destilados raros, el ritmo baja aún más. Botánicos propios, hielo tallado a mano y acústica envolvente.",
        secondaryCta: { label: "Regalar una noche + cena", href: "#regalar" }
      },
      {
        id: "suites",
        still: "/world/stop-4-habitacion.webp",
        scrollWeight: 1.4,
        mobileObjectPosition: "50% center",
        stepNumber: "05",
        tag: "El Descanso · Cama Emperor 2×2 m",
        title: "Dos metros por dos metros de calma absoluta",
        description: "Al final del recorrido aguarda tu refugio privado. Una cama de 200×200 cm vestida en lino lavado a la piedra, luz cálida regulable y silencio absoluto para el descanso más profundo.",
        showRoomSelector: true
      }
    ] as WorldStop[]
  }
};
