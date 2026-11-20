import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

async function seedProducts() {
  try {
    const uri = process.env.MONGO_URI || "mongodb+srv://Dhruv:Dhruv123@cluster0.ddark6d.mongodb.net/game_store?retryWrites=true&w=majority";
    await mongoose.connect(uri);
    console.log("✅ MongoDB Connected for Games Insertion");

    const productSchema = new mongoose.Schema({
      name: String,
      category: String,
      price: Number,
      discountPrice: Number,
      sku: String,
      img: String,
      description: String,
      platform: String,
      genre: String,
      developer: String,
      publisher: String,
      rating: String,
      releaseYear: Number,
      edition: [String],
      size: [String],
      brand: String,
      fabric: String,
      color: String,
      occasion: String,
      inStock: Boolean,
      ratings: Number,
      reviews: Number,
    });

    const Product = mongoose.models.Product || mongoose.model("Product", productSchema);

    const games = [
      {
        name: "Cyberpunk 2077: Ultimate Edition",
        category: "Action & RPG",
        price: 3499,
        discountPrice: 2499,
        sku: "GAME-CP2077-ULT",
        img: "https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&q=80&w=1000",
        description: "Immerse yourself in Night City as V, a mercenary outlaw navigating high-tech cyberware, neon underworlds, and the gripping Phantom Liberty expansion.",
        platform: "PC / PS5 / Xbox",
        genre: "Open World RPG",
        developer: "CD Projekt Red",
        publisher: "CD Projekt",
        rating: "ESRB M (17+)",
        edition: ["Standard Edition", "Deluxe Edition", "Collector's Edition"],
        size: ["Standard Edition", "Deluxe Edition", "Collector's Edition"],
        brand: "CD Projekt Red",
        fabric: "PC / PS5",
        color: "Neon Yellow",
        occasion: "Open World RPG",
        inStock: true,
        ratings: 4.9,
        reviews: 1420
      },
      {
        name: "Elden Ring: Shadow of the Erdtree",
        category: "Action & RPG",
        price: 3999,
        discountPrice: 3499,
        sku: "GAME-ER-ERDTREE",
        img: "https://images.unsplash.com/photo-1534423861386-85a16f5d13fd?auto=format&fit=crop&q=80&w=1000",
        description: "Winner of Game of the Year. Step into the Land of Shadow, uncover enigmatic lore, conquer fearsome demigods, and master new weapon arts.",
        platform: "PS5",
        genre: "Action RPG / Souls-like",
        developer: "FromSoftware",
        publisher: "Bandai Namco",
        rating: "ESRB M (17+)",
        edition: ["Standard Edition", "Shadow of Erdtree Deluxe", "Collector's Edition"],
        size: ["Standard Edition", "Deluxe Edition", "Collector's Edition"],
        brand: "Bandai Namco",
        fabric: "PlayStation 5",
        color: "Golden",
        occasion: "Action RPG",
        inStock: true,
        ratings: 5.0,
        reviews: 2850
      },
      {
        name: "God of War Ragnarök",
        category: "PS5",
        price: 4499,
        discountPrice: 2999,
        sku: "GAME-GOW-RAG",
        img: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&q=80&w=1000",
        description: "Kratos and Atreus embark on a mythic journey through the Nine Realms as Asgardian forces prepare for the prophesied battle that will end the world.",
        platform: "PS5",
        genre: "Action-Adventure",
        developer: "Santa Monica Studio",
        publisher: "Sony Interactive Entertainment",
        rating: "ESRB M (17+)",
        edition: ["Standard Edition", "Digital Deluxe Edition", "Jötnar Edition"],
        size: ["Standard Edition", "Deluxe Edition", "Collector's Edition"],
        brand: "PlayStation Studios",
        fabric: "PlayStation 5",
        color: "Frost Ice Blue",
        occasion: "Action-Adventure",
        inStock: true,
        ratings: 4.9,
        reviews: 3100
      },
      {
        name: "Marvel's Spider-Man 2",
        category: "PS5",
        price: 4999,
        discountPrice: 3799,
        sku: "GAME-SPIDERMAN-2",
        img: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?auto=format&fit=crop&q=80&w=1000",
        description: "Peter Parker and Miles Morales return in an epic adventure across Marvel's New York with symbiote powers, dual-hero switching, and Venom.",
        platform: "PS5",
        genre: "Action-Adventure",
        developer: "Insomniac Games",
        publisher: "Sony Interactive Entertainment",
        rating: "ESRB T (13+)",
        edition: ["Standard Edition", "Digital Deluxe"],
        size: ["Standard Edition", "Deluxe Edition"],
        brand: "PlayStation Studios",
        fabric: "PlayStation 5",
        color: "Symbiote Black & Red",
        occasion: "Superhero Action",
        inStock: true,
        ratings: 4.8,
        reviews: 1890
      },
      {
        name: "Grand Theft Auto V: Premium Edition",
        category: "Open World",
        price: 1999,
        discountPrice: 999,
        sku: "GAME-GTAV-PREM",
        img: "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&q=80&w=1000",
        description: "Experience the complete Los Santos story alongside the ever-evolving world of Grand Theft Auto Online with the Criminal Enterprise Starter Pack included.",
        platform: "PC Games",
        genre: "Open World Action",
        developer: "Rockstar North",
        publisher: "Rockstar Games",
        rating: "ESRB M (17+)",
        edition: ["Standard Edition", "Premium Online Edition"],
        size: ["Standard Edition", "Premium Edition"],
        brand: "Rockstar Games",
        fabric: "PC Games",
        color: "Green",
        occasion: "Open World Action",
        inStock: true,
        ratings: 4.9,
        reviews: 5800
      },
      {
        name: "PlayStation 5 Slim Console (1TB Disc Edition)",
        category: "Consoles & Gear",
        price: 54990,
        discountPrice: 49990,
        sku: "HARD-PS5-SLIM-1TB",
        img: "https://images.unsplash.com/photo-1606813907291-d86efa9b94db?auto=format&fit=crop&q=80&w=1000",
        description: "Experience lightning-fast loading with an ultra-high speed SSD, deeper immersion with haptic feedback, adaptive triggers, and 3D Audio, in a sleek slim design.",
        platform: "PS5",
        genre: "Gaming Console",
        developer: "Sony",
        publisher: "Sony Interactive Entertainment",
        rating: "Hardware",
        edition: ["Disc Edition 1TB", "Digital Edition 1TB"],
        size: ["Disc Edition 1TB", "Digital Edition 1TB"],
        brand: "Sony PlayStation",
        fabric: "Console Hardware",
        color: "Glacier White",
        occasion: "Next-Gen Gaming",
        inStock: true,
        ratings: 5.0,
        reviews: 950
      },
      {
        name: "DualSense Wireless Controller - Midnight Black",
        category: "Accessories",
        price: 6390,
        discountPrice: 5490,
        sku: "ACC-DUALSENSE-BLK",
        img: "https://images.unsplash.com/photo-1614680376593-902f749f7ffc?auto=format&fit=crop&q=80&w=1000",
        description: "Discover a deeper gaming experience with the innovative PS5 controller, featuring immersive haptic feedback and dynamic trigger effects.",
        platform: "PS5",
        genre: "Controller",
        developer: "Sony",
        publisher: "Sony Interactive Entertainment",
        rating: "Hardware",
        edition: ["Standard Wireless"],
        size: ["Standard Wireless"],
        brand: "Sony PlayStation",
        fabric: "Gaming Peripheral",
        color: "Midnight Black",
        occasion: "Gaming Accessories",
        inStock: true,
        ratings: 4.8,
        reviews: 1240
      }
    ];

    await Product.deleteMany({});
    await Product.insertMany(games);
    console.log("✅ Games inserted successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Insertion error:", error);
    process.exit(1);
  }
}

seedProducts();
