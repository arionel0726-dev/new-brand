-- phpMyAdmin SQL Dump
-- version 5.2.0
-- https://www.phpmyadmin.net/
--
-- Хост: 127.0.0.1
-- Время создания: Окт 20 2026 г., 16:12
-- Версия сервера: 10.4.27-MariaDB
-- Версия PHP: 7.4.33

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- База данных: `vizaje_nica_local`
--

-- --------------------------------------------------------

--
-- Структура таблицы `admins`
--

CREATE TABLE `admins` (
  `id` int(11) NOT NULL,
  `login` varchar(50) NOT NULL DEFAULT '',
  `password` varchar(255) NOT NULL DEFAULT '',
  `admin_type` int(11) NOT NULL DEFAULT 2,
  `status` int(11) NOT NULL DEFAULT 1 COMMENT '1 - enabled; 0 - deleted',
  `sorder` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `analytics_events`
--

CREATE TABLE `analytics_events` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `event_uid` char(36) NOT NULL,
  `event_name` varchar(40) NOT NULL,
  `visitor_key` char(64) NOT NULL,
  `session_key` char(64) NOT NULL,
  `cart_key` char(64) DEFAULT NULL,
  `product_id` int(11) DEFAULT NULL,
  `category_id` int(11) DEFAULT NULL,
  `order_id` int(11) DEFAULT NULL,
  `quantity` int(11) UNSIGNED DEFAULT NULL,
  `cart_items_count` int(11) UNSIGNED DEFAULT NULL,
  `cart_value` decimal(12,2) DEFAULT NULL,
  `event_value` decimal(12,2) DEFAULT NULL,
  `currency` char(3) DEFAULT NULL,
  `page_path` varchar(255) DEFAULT NULL,
  `traffic_source` varchar(80) DEFAULT NULL,
  `traffic_medium` varchar(80) DEFAULT NULL,
  `traffic_campaign` varchar(120) DEFAULT NULL,
  `referrer_host` varchar(191) DEFAULT NULL,
  `device_type` varchar(16) DEFAULT NULL,
  `consent_version` varchar(32) NOT NULL,
  `created_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `articles`
--

CREATE TABLE `articles` (
  `id` int(11) NOT NULL,
  `date` date NOT NULL,
  `uriRU` varchar(300) NOT NULL,
  `uriRO` varchar(300) NOT NULL,
  `uriEN` varchar(300) NOT NULL,
  `titleRU` varchar(250) DEFAULT NULL,
  `titleRO` varchar(250) DEFAULT NULL,
  `titleEN` varchar(255) DEFAULT NULL,
  `descRU` text NOT NULL,
  `descRO` text NOT NULL,
  `descEN` text NOT NULL,
  `textRU` text DEFAULT NULL,
  `textRO` text DEFAULT NULL,
  `textEN` text DEFAULT NULL,
  `textLRU` text DEFAULT NULL,
  `textLRO` text DEFAULT NULL,
  `textLEN` text DEFAULT NULL,
  `seoTitleRU` varchar(250) DEFAULT NULL,
  `seoTitleRO` varchar(250) DEFAULT NULL,
  `seoTitleEN` varchar(255) DEFAULT NULL,
  `seoKeywordsRU` text DEFAULT NULL,
  `seoKeywordsRO` text DEFAULT NULL,
  `seoKeywordsEN` text DEFAULT NULL,
  `seoDescRU` text DEFAULT NULL,
  `tagsRU` varchar(500) NOT NULL DEFAULT '',
  `seoDescRO` text DEFAULT NULL,
  `tagsRO` varchar(500) NOT NULL DEFAULT '',
  `seoDescEN` text DEFAULT NULL,
  `menuON` int(11) NOT NULL,
  `isShown` tinyint(1) NOT NULL DEFAULT 1,
  `isBlog` tinyint(1) NOT NULL DEFAULT 0,
  `sorder` int(11) NOT NULL DEFAULT 1,
  `img` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `article_likes`
--

CREATE TABLE `article_likes` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `article_id` int(11) NOT NULL,
  `visitor_key` char(64) NOT NULL,
  `created_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `banners`
--

CREATE TABLE `banners` (
  `id` int(11) NOT NULL,
  `titleRU` varchar(250) DEFAULT NULL,
  `titleRO` varchar(250) DEFAULT NULL,
  `titleEN` varchar(255) DEFAULT NULL,
  `uriRU` varchar(300) NOT NULL,
  `uriRO` varchar(300) NOT NULL,
  `uriEN` varchar(300) NOT NULL,
  `ColorText` varchar(32) NOT NULL,
  `ColorButton` varchar(32) NOT NULL,
  `ColorButtonText` varchar(32) NOT NULL,
  `isShown` tinyint(1) NOT NULL DEFAULT 1,
  `sorder` int(11) NOT NULL DEFAULT 1,
  `img` varchar(255) DEFAULT NULL,
  `imgMob` varchar(254) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `brands`
--

CREATE TABLE `brands` (
  `id` int(11) NOT NULL,
  `GUID` varchar(128) NOT NULL,
  `title` varchar(256) DEFAULT NULL,
  `h1RO` varchar(255) DEFAULT NULL,
  `h1RU` varchar(255) DEFAULT NULL,
  `breadcrumbTitleRO` varchar(255) DEFAULT NULL,
  `breadcrumbTitleRU` varchar(255) DEFAULT NULL,
  `uri` varchar(256) DEFAULT NULL,
  `textRU` text NOT NULL,
  `textRO` text NOT NULL,
  `textEN` text NOT NULL,
  `img` varchar(256) DEFAULT NULL,
  `seoTitleRU` varchar(255) DEFAULT NULL,
  `seoTitleRO` varchar(255) DEFAULT NULL,
  `seoTitleEN` varchar(255) DEFAULT NULL,
  `seoKeywordsRU` text DEFAULT NULL,
  `seoKeywordsRO` text DEFAULT NULL,
  `seoKeywordsEN` text DEFAULT NULL,
  `seoDescRU` text DEFAULT NULL,
  `seoDescRO` text DEFAULT NULL,
  `seoTextRO` mediumtext DEFAULT NULL,
  `seoTextRU` mediumtext DEFAULT NULL,
  `seoDescEN` text DEFAULT NULL,
  `sorder` int(11) DEFAULT 0,
  `top` int(11) NOT NULL,
  `isShown` tinyint(1) DEFAULT 1,
  `updated_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `brand_certificates`
--

CREATE TABLE `brand_certificates` (
  `id` int(10) UNSIGNED NOT NULL,
  `brand_id` int(10) UNSIGNED NOT NULL,
  `titleRU` varchar(255) DEFAULT NULL,
  `titleRO` varchar(255) DEFAULT NULL,
  `image` varchar(255) NOT NULL,
  `preview_image` varchar(255) DEFAULT NULL,
  `sorder` int(11) NOT NULL DEFAULT 0,
  `isShown` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `categories`
--

CREATE TABLE `categories` (
  `id` int(11) NOT NULL,
  `GUID` varchar(128) NOT NULL,
  `parent_id` int(11) NOT NULL DEFAULT 0,
  `feature_type` int(11) NOT NULL,
  `step` int(11) NOT NULL,
  `titleRU` varchar(256) DEFAULT NULL,
  `h1RU` varchar(255) DEFAULT NULL,
  `breadcrumbTitleRU` varchar(255) DEFAULT NULL,
  `titleRO` varchar(256) DEFAULT NULL,
  `h1RO` varchar(255) DEFAULT NULL,
  `breadcrumbTitleRO` varchar(255) DEFAULT NULL,
  `titleEN` varchar(256) DEFAULT NULL,
  `uriRU` varchar(256) DEFAULT NULL,
  `uriRO` varchar(256) DEFAULT NULL,
  `uriEN` varchar(256) DEFAULT NULL,
  `img` varchar(256) DEFAULT NULL,
  `imgNav` varchar(254) NOT NULL,
  `imgNavHover` varchar(254) NOT NULL,
  `calculator` int(11) NOT NULL,
  `search_teg` varchar(255) NOT NULL,
  `seoTitleRU` varchar(255) DEFAULT NULL,
  `seoTitleRO` varchar(255) DEFAULT NULL,
  `seoTitleEN` varchar(255) DEFAULT NULL,
  `descRU` text NOT NULL,
  `descRO` text NOT NULL,
  `descEN` text NOT NULL,
  `seoKeywordsRU` text DEFAULT NULL,
  `seoKeywordsRO` text DEFAULT NULL,
  `seoKeywordsEN` text DEFAULT NULL,
  `seoDescRU` text DEFAULT NULL,
  `seoTextRU` mediumtext DEFAULT NULL,
  `seoDescRO` text DEFAULT NULL,
  `seoTextRO` mediumtext DEFAULT NULL,
  `seoDescEN` text DEFAULT NULL,
  `top_menu` int(11) NOT NULL,
  `footer_menu` int(11) NOT NULL,
  `sorder` int(11) DEFAULT 0,
  `wallpaper` int(11) NOT NULL,
  `isShown` tinyint(1) DEFAULT 1,
  `isCustomMobile` tinyint(1) NOT NULL DEFAULT 0,
  `updated_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `category_banner`
--

CREATE TABLE `category_banner` (
  `id` int(11) NOT NULL,
  `category_id` int(11) NOT NULL,
  `titleRU` varchar(256) DEFAULT NULL,
  `titleRO` varchar(256) DEFAULT NULL,
  `titleEN` varchar(256) DEFAULT NULL,
  `uriRU` varchar(256) DEFAULT NULL,
  `uriRO` varchar(256) DEFAULT NULL,
  `uriEN` varchar(256) DEFAULT NULL,
  `descRU` varchar(256) DEFAULT NULL,
  `descRO` varchar(256) DEFAULT NULL,
  `descEN` varchar(256) DEFAULT NULL,
  `img` varchar(256) DEFAULT NULL,
  `sorder` int(11) DEFAULT 0,
  `isShown` tinyint(1) DEFAULT 1,
  `updated_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `clients`
--

CREATE TABLE `clients` (
  `id` int(11) NOT NULL,
  `id_fb` int(11) NOT NULL,
  `active` int(11) NOT NULL,
  `Discount` varchar(16) NOT NULL,
  `Bonus` varchar(16) NOT NULL,
  `name` varchar(255) NOT NULL DEFAULT '0',
  `surname` varchar(256) DEFAULT NULL,
  `phone` varchar(256) DEFAULT NULL,
  `email` text DEFAULT NULL,
  `address` varchar(254) DEFAULT NULL,
  `apartament` varchar(64) DEFAULT NULL,
  `city` varchar(64) DEFAULT NULL,
  `house` varchar(64) DEFAULT NULL,
  `porch` varchar(64) DEFAULT NULL,
  `birthday` varchar(256) DEFAULT NULL,
  `sex` int(11) NOT NULL,
  `password` varchar(256) DEFAULT NULL,
  `code` int(11) NOT NULL,
  `sms_subscribe` int(11) NOT NULL,
  `mail_subscribe` int(11) NOT NULL,
  `sorder` int(11) DEFAULT 0,
  `isShown` tinyint(1) DEFAULT 1,
  `isb2b` tinyint(4) NOT NULL DEFAULT 0,
  `welcome_offer_started_at` datetime DEFAULT NULL,
  `welcome_offer_expires_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `collections`
--

CREATE TABLE `collections` (
  `id` int(11) NOT NULL,
  `GUID` varchar(128) NOT NULL,
  `brand_id` int(11) NOT NULL,
  `titleRU` varchar(256) DEFAULT NULL,
  `titleRO` varchar(256) DEFAULT NULL,
  `titleEN` varchar(256) DEFAULT NULL,
  `uriRU` varchar(256) DEFAULT NULL,
  `uriRO` varchar(256) DEFAULT NULL,
  `uriEN` varchar(256) DEFAULT NULL,
  `descRU` varchar(256) DEFAULT NULL,
  `descRO` varchar(256) DEFAULT NULL,
  `descEN` varchar(256) DEFAULT NULL,
  `img` varchar(256) DEFAULT NULL,
  `seoTitleRU` varchar(255) DEFAULT NULL,
  `seoTitleRO` varchar(255) DEFAULT NULL,
  `seoTitleEN` varchar(255) DEFAULT NULL,
  `seoKeywordsRU` text DEFAULT NULL,
  `seoKeywordsRO` text DEFAULT NULL,
  `seoKeywordsEN` text DEFAULT NULL,
  `seoDescRU` text DEFAULT NULL,
  `seoDescRO` text DEFAULT NULL,
  `seoDescEN` text DEFAULT NULL,
  `sorder` int(11) DEFAULT 0,
  `top` int(11) NOT NULL,
  `isShown` tinyint(1) DEFAULT 1,
  `updated_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `consent_events`
--

CREATE TABLE `consent_events` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `client_id` int(10) UNSIGNED DEFAULT NULL,
  `channel` varchar(40) NOT NULL,
  `consent_value` tinyint(3) UNSIGNED NOT NULL DEFAULT 0,
  `source` varchar(40) NOT NULL,
  `content` text NOT NULL,
  `email` varchar(190) DEFAULT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `created_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `constants`
--

CREATE TABLE `constants` (
  `id` int(11) NOT NULL,
  `name` varchar(250) DEFAULT NULL,
  `description` varchar(250) DEFAULT NULL,
  `EN` text DEFAULT NULL,
  `RO` text NOT NULL,
  `RU` text DEFAULT NULL,
  `fieldType` tinyint(1) NOT NULL DEFAULT 0,
  `groupes` enum('errors','transliteration','contacts','form','choose','about','dates') NOT NULL,
  `sorder` int(11) NOT NULL DEFAULT 999,
  `isShown` int(11) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `dates`
--

CREATE TABLE `dates` (
  `id` int(11) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `date_start` date DEFAULT NULL,
  `date_end` date DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `delivery`
--

CREATE TABLE `delivery` (
  `id` int(11) NOT NULL,
  `title1RU` varchar(250) DEFAULT NULL,
  `title1RO` varchar(250) DEFAULT NULL,
  `descL1RU` text NOT NULL,
  `descL1RO` text NOT NULL,
  `descR1RU` text NOT NULL,
  `descR1RO` text NOT NULL,
  `note1RU` text NOT NULL,
  `note1RO` text NOT NULL,
  `text1RU` text NOT NULL,
  `text1RO` text NOT NULL,
  `title2RU` varchar(250) DEFAULT NULL,
  `title2RO` varchar(250) DEFAULT NULL,
  `descL2RU` text NOT NULL,
  `descL2RO` text NOT NULL,
  `descR2RU` text NOT NULL,
  `descR2RO` text NOT NULL,
  `title3RU` varchar(250) DEFAULT NULL,
  `title3RO` varchar(250) DEFAULT NULL,
  `descL3RU` text NOT NULL,
  `descL3RO` text NOT NULL,
  `descR3RU` text NOT NULL,
  `descR3RO` text NOT NULL,
  `title4RU` varchar(250) DEFAULT NULL,
  `title4RO` varchar(250) DEFAULT NULL,
  `descL4RU` text NOT NULL,
  `descL4RO` text NOT NULL,
  `descR4RU` text NOT NULL,
  `descR4RO` text NOT NULL,
  `isShown` tinyint(1) NOT NULL DEFAULT 1,
  `sorder` int(11) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `home_brand_sections`
--

CREATE TABLE `home_brand_sections` (
  `id` int(10) UNSIGNED NOT NULL,
  `titleRU` varchar(255) NOT NULL,
  `titleRO` varchar(255) NOT NULL,
  `urlRU` varchar(500) NOT NULL,
  `urlRO` varchar(500) NOT NULL,
  `img` varchar(255) DEFAULT NULL,
  `imgMob` varchar(255) DEFAULT NULL,
  `placement` enum('after_new','after_sale') NOT NULL DEFAULT 'after_new',
  `sorder` int(11) NOT NULL DEFAULT 0,
  `isShown` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `home_brand_section_products`
--

CREATE TABLE `home_brand_section_products` (
  `id` int(10) UNSIGNED NOT NULL,
  `section_id` int(10) UNSIGNED NOT NULL,
  `product_id` int(10) UNSIGNED NOT NULL,
  `sorder` int(11) NOT NULL DEFAULT 0,
  `isShown` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `home_categories`
--

CREATE TABLE `home_categories` (
  `id` int(10) UNSIGNED NOT NULL,
  `titleRU` varchar(255) NOT NULL,
  `titleRO` varchar(255) NOT NULL,
  `urlRU` varchar(500) NOT NULL,
  `urlRO` varchar(500) NOT NULL,
  `img` varchar(255) DEFAULT NULL,
  `sorder` int(11) NOT NULL DEFAULT 0,
  `isShown` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `home_product_items`
--

CREATE TABLE `home_product_items` (
  `id` int(10) UNSIGNED NOT NULL,
  `section_key` varchar(30) NOT NULL,
  `product_id` int(10) UNSIGNED NOT NULL,
  `sorder` int(11) NOT NULL DEFAULT 0,
  `isShown` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `menu`
--

CREATE TABLE `menu` (
  `id` int(11) NOT NULL,
  `uriRU` varchar(300) NOT NULL,
  `uriRO` varchar(300) NOT NULL,
  `uriEN` varchar(300) NOT NULL,
  `titleRU` varchar(250) DEFAULT NULL,
  `titleRO` varchar(250) DEFAULT NULL,
  `titleEN` varchar(255) DEFAULT NULL,
  `descRU` text NOT NULL,
  `descRO` text NOT NULL,
  `descEN` text NOT NULL,
  `textRU` text DEFAULT NULL,
  `textRO` text DEFAULT NULL,
  `textEN` text DEFAULT NULL,
  `seoTitleRU` varchar(250) DEFAULT NULL,
  `seoTitleRO` varchar(250) DEFAULT NULL,
  `seoTitleEN` varchar(255) DEFAULT NULL,
  `seoKeywordsRU` text DEFAULT NULL,
  `seoKeywordsRO` text DEFAULT NULL,
  `seoKeywordsEN` text DEFAULT NULL,
  `seoDescRU` text DEFAULT NULL,
  `seoDescRO` text DEFAULT NULL,
  `breadcrumbTitleRO` varchar(255) DEFAULT NULL,
  `breadcrumbTitleRU` varchar(255) DEFAULT NULL,
  `seoDescEN` text DEFAULT NULL,
  `isShown` tinyint(1) NOT NULL DEFAULT 1,
  `sorder` int(11) NOT NULL DEFAULT 1,
  `onTop` int(11) NOT NULL DEFAULT 0,
  `onBottom` int(11) NOT NULL DEFAULT 0,
  `parentID` int(11) DEFAULT 0,
  `system` tinyint(1) NOT NULL DEFAULT 0,
  `img` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `offers`
--

CREATE TABLE `offers` (
  `id` int(11) NOT NULL,
  `date_from` date NOT NULL,
  `date_to` date NOT NULL,
  `titleRU` varchar(256) DEFAULT NULL,
  `titleRO` varchar(256) DEFAULT NULL,
  `titleEN` varchar(256) DEFAULT NULL,
  `descRU` varchar(1024) NOT NULL,
  `descRO` varchar(1024) NOT NULL,
  `descEN` varchar(1024) NOT NULL,
  `uriRU` varchar(256) DEFAULT NULL,
  `uriRO` varchar(256) DEFAULT NULL,
  `uriEN` varchar(256) DEFAULT NULL,
  `sale` varchar(32) NOT NULL,
  `is_online` tinyint(1) NOT NULL DEFAULT 1,
  `locationRU` varchar(254) NOT NULL,
  `locationRO` varchar(254) NOT NULL,
  `imgB` varchar(255) NOT NULL,
  `img` varchar(256) DEFAULT NULL,
  `imgRU` varchar(254) NOT NULL,
  `imgRO` varchar(254) NOT NULL,
  `imgBRU` varchar(254) NOT NULL,
  `imgBRO` varchar(254) NOT NULL,
  `seoTitleRU` varchar(255) DEFAULT NULL,
  `seoTitleRO` varchar(255) DEFAULT NULL,
  `seoTitleEN` varchar(255) DEFAULT NULL,
  `seoKeywordsRU` text DEFAULT NULL,
  `seoKeywordsRO` text DEFAULT NULL,
  `seoKeywordsEN` text DEFAULT NULL,
  `seoDescRU` text DEFAULT NULL,
  `seoDescRO` text DEFAULT NULL,
  `seoDescEN` text DEFAULT NULL,
  `view_home` int(11) NOT NULL,
  `sorder` int(11) DEFAULT 0,
  `isShown` tinyint(1) DEFAULT 1,
  `updated_at` date NOT NULL,
  `created_at` date DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `offers_products`
--

CREATE TABLE `offers_products` (
  `id` int(11) NOT NULL,
  `offers_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `SKU` varchar(32) NOT NULL,
  `sorder` int(11) NOT NULL,
  `isShown` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `orders`
--

CREATE TABLE `orders` (
  `id` int(11) NOT NULL,
  `order_source` varchar(16) NOT NULL DEFAULT 'unknown',
  `order_id` int(11) DEFAULT NULL,
  `status` enum('new','progress','finished','canceled') NOT NULL DEFAULT 'new',
  `1c` int(11) NOT NULL,
  `client_id` int(11) NOT NULL,
  `total` varchar(64) NOT NULL,
  `delivery_price` int(11) NOT NULL,
  `delivery` int(11) DEFAULT NULL,
  `bonus_plus` varchar(32) NOT NULL,
  `bonus_minus` varchar(32) NOT NULL,
  `payment` int(11) DEFAULT NULL,
  `pay_success` int(11) NOT NULL,
  `stores` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `surname` varchar(255) DEFAULT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(255) NOT NULL,
  `message` text DEFAULT NULL,
  `contactName` varchar(128) NOT NULL,
  `postcode` varchar(32) NOT NULL,
  `address` varchar(255) NOT NULL,
  `street` varchar(128) NOT NULL,
  `locality` varchar(128) NOT NULL,
  `town` varchar(128) NOT NULL,
  `county` varchar(128) NOT NULL,
  `city` varchar(255) NOT NULL,
  `telephone` varchar(32) NOT NULL,
  `notes` text NOT NULL,
  `ip` varchar(128) NOT NULL,
  `ExternalID` varchar(64) NOT NULL,
  `voucher` varchar(32) NOT NULL,
  `added` datetime DEFAULT current_timestamp(),
  `updated` datetime DEFAULT NULL,
  `sorder` int(11) NOT NULL,
  `isb2b` tinyint(4) NOT NULL DEFAULT 0,
  `promo_id` int(10) UNSIGNED DEFAULT NULL,
  `promo_code` varchar(64) DEFAULT NULL,
  `promo_discount` decimal(10,2) NOT NULL DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `orders_products`
--

CREATE TABLE `orders_products` (
  `id` int(11) NOT NULL,
  `order_id` int(11) NOT NULL,
  `product_id` int(11) DEFAULT NULL,
  `qty` int(11) DEFAULT NULL,
  `price` varchar(64) DEFAULT NULL,
  `total` varchar(64) DEFAULT NULL,
  `options` varchar(32) DEFAULT NULL,
  `promo_discount` decimal(10,2) NOT NULL DEFAULT 0.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `paynet_logs`
--

CREATE TABLE `paynet_logs` (
  `id` int(11) NOT NULL,
  `order_id` varchar(255) NOT NULL,
  `message` varchar(255) NOT NULL,
  `response` text DEFAULT NULL,
  `date` varchar(32) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `personal_data_requests`
--

CREATE TABLE `personal_data_requests` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `client_id` int(10) UNSIGNED DEFAULT NULL,
  `request_type` varchar(32) NOT NULL,
  `details` text NOT NULL,
  `source` varchar(40) NOT NULL DEFAULT 'account',
  `status` varchar(24) NOT NULL DEFAULT 'new',
  `identity_verified` tinyint(3) UNSIGNED NOT NULL DEFAULT 1,
  `admin_note` text DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  `processed_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `products`
--

CREATE TABLE `products` (
  `id` int(11) NOT NULL,
  `GUID` varchar(128) NOT NULL,
  `SKU` varchar(128) NOT NULL,
  `titleRU` varchar(256) DEFAULT NULL,
  `h1RU` varchar(255) DEFAULT NULL,
  `breadcrumbTitleRU` varchar(255) DEFAULT NULL,
  `titleRO` varchar(255) NOT NULL,
  `h1RO` varchar(255) DEFAULT NULL,
  `breadcrumbTitleRO` varchar(255) DEFAULT NULL,
  `titleEN` varchar(255) NOT NULL,
  `descRU` varchar(255) NOT NULL,
  `descRO` varchar(255) NOT NULL,
  `descEN` varchar(255) NOT NULL,
  `textRU` text DEFAULT NULL,
  `textRO` text DEFAULT NULL,
  `textEN` text NOT NULL,
  `uriRU` varchar(256) DEFAULT NULL,
  `uriRO` varchar(256) DEFAULT NULL,
  `uriEN` varchar(255) NOT NULL,
  `price` float DEFAULT NULL,
  `discount_price` float DEFAULT NULL,
  `sale_mdl` int(11) NOT NULL,
  `sale_percent` int(11) NOT NULL,
  `volume` varchar(32) NOT NULL,
  `on_stock` int(11) DEFAULT 1,
  `stock` int(11) NOT NULL,
  `is_new` tinyint(4) DEFAULT 0,
  `best_selling` int(11) NOT NULL,
  `category_id` int(11) DEFAULT NULL,
  `brand_id` int(11) DEFAULT 0,
  `feature_type` int(11) NOT NULL,
  `reviews` varchar(64) NOT NULL,
  `variations` varchar(32) NOT NULL,
  `instructionRU` varchar(254) DEFAULT NULL,
  `instructionRO` varchar(254) DEFAULT NULL,
  `instructionEN` varchar(254) DEFAULT NULL,
  `componentsRU` varchar(254) DEFAULT NULL,
  `componentsRO` varchar(254) DEFAULT NULL,
  `componentsEN` varchar(254) DEFAULT NULL,
  `sex` varchar(64) DEFAULT NULL,
  `search_teg` varchar(255) NOT NULL,
  `seoTitleRU` varchar(255) DEFAULT NULL,
  `seoTitleRO` varchar(255) DEFAULT NULL,
  `seoTitleEN` varchar(255) DEFAULT NULL,
  `seoKeywordsRU` text DEFAULT NULL,
  `seoKeywordsRO` text DEFAULT NULL,
  `seoKeywordsEN` text DEFAULT NULL,
  `seoDescRU` text DEFAULT NULL,
  `seoDescRO` text DEFAULT NULL,
  `seoDescEN` text DEFAULT NULL,
  `order` int(11) NOT NULL,
  `sorder` int(11) DEFAULT 1,
  `isShown` tinyint(1) DEFAULT 1,
  `updated_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `priceWH` float NOT NULL,
  `barcode` varchar(256) DEFAULT NULL,
  `on_stockWH` int(11) NOT NULL,
  `WarehouseName` varchar(256) DEFAULT NULL,
  `youtube_video_id` varchar(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `products_features`
--

CREATE TABLE `products_features` (
  `id` int(11) NOT NULL,
  `product_id` int(5) DEFAULT NULL,
  `category_id` int(5) DEFAULT NULL,
  `feature_id` int(5) DEFAULT NULL,
  `feature_value_id` int(5) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `products_img`
--

CREATE TABLE `products_img` (
  `id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `img` varchar(64) NOT NULL,
  `sorder` int(11) NOT NULL,
  `isShown` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `products_more`
--

CREATE TABLE `products_more` (
  `product_id` int(11) NOT NULL,
  `related_id` int(11) NOT NULL
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `products_related`
--

CREATE TABLE `products_related` (
  `product_id` int(11) NOT NULL,
  `related_id` int(11) NOT NULL
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `products_variable`
--

CREATE TABLE `products_variable` (
  `id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `SKU` varchar(32) DEFAULT NULL,
  `titleRU` varchar(256) DEFAULT NULL,
  `titleRO` varchar(255) NOT NULL,
  `titleEN` varchar(255) NOT NULL,
  `colorRU` varchar(254) NOT NULL,
  `colorRO` varchar(254) NOT NULL,
  `color_data` text DEFAULT NULL,
  `colorHex` varchar(7) DEFAULT NULL,
  `VolumeVar` varchar(254) NOT NULL,
  `color` varchar(254) DEFAULT NULL,
  `dose` varchar(255) DEFAULT NULL,
  `price` double DEFAULT NULL,
  `discount_price` varchar(32) NOT NULL,
  `qty` int(11) NOT NULL,
  `sorder` int(11) NOT NULL,
  `isShown` tinyint(4) DEFAULT 1,
  `updated_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `colorEN` varchar(254) NOT NULL,
  `priceWH` double NOT NULL,
  `barcode` varchar(256) DEFAULT NULL,
  `qtyWH` int(11) NOT NULL,
  `WarehouseName` varchar(256) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `products_variable_img`
--

CREATE TABLE `products_variable_img` (
  `id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `variable_id` int(11) NOT NULL,
  `img` varchar(64) NOT NULL,
  `sorder` int(11) NOT NULL,
  `isShown` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `product_categories`
--

CREATE TABLE `product_categories` (
  `id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `category_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `product_import_changes`
--

CREATE TABLE `product_import_changes` (
  `id` int(10) UNSIGNED NOT NULL,
  `product_id` int(10) UNSIGNED NOT NULL,
  `product_guid` varchar(128) NOT NULL,
  `action` varchar(16) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'new',
  `changed_fields` longtext NOT NULL,
  `created_at` datetime NOT NULL,
  `reviewed_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `product_search`
--

CREATE TABLE `product_search` (
  `id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `variable_id` int(11) DEFAULT NULL,
  `GUID` varchar(128) DEFAULT NULL,
  `SKU` varchar(128) DEFAULT NULL,
  `title` text DEFAULT NULL,
  `color` text DEFAULT NULL,
  `volume` text DEFAULT NULL,
  `search_text` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `promocodes`
--

CREATE TABLE `promocodes` (
  `id` int(10) UNSIGNED NOT NULL,
  `name` varchar(255) NOT NULL,
  `code` varchar(64) NOT NULL,
  `type` enum('percentage','fixed') NOT NULL,
  `value` decimal(10,2) NOT NULL,
  `min_amount` decimal(10,2) DEFAULT NULL,
  `max_discount` decimal(10,2) DEFAULT NULL,
  `usage_limit` int(10) UNSIGNED DEFAULT NULL,
  `per_user_limit` int(10) UNSIGNED DEFAULT 1,
  `allow_discounted` tinyint(1) NOT NULL DEFAULT 0,
  `starts_at` datetime DEFAULT NULL,
  `ends_at` datetime DEFAULT NULL,
  `status` enum('draft','active','disabled') NOT NULL DEFAULT 'draft',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL,
  `brand_scope` enum('all','selected') NOT NULL DEFAULT 'all'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `promocode_brands`
--

CREATE TABLE `promocode_brands` (
  `promocode_id` int(10) UNSIGNED NOT NULL,
  `brand_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `promocode_events`
--

CREATE TABLE `promocode_events` (
  `id` int(11) NOT NULL,
  `promocode_id` int(11) DEFAULT NULL,
  `client_id` int(11) DEFAULT NULL,
  `order_id` int(11) DEFAULT NULL,
  `code` varchar(100) NOT NULL,
  `event_type` varchar(50) NOT NULL,
  `cart_subtotal` decimal(12,2) NOT NULL DEFAULT 0.00,
  `discount_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `final_total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `reason` varchar(100) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `promocode_excluded_brands`
--

CREATE TABLE `promocode_excluded_brands` (
  `id` int(10) UNSIGNED NOT NULL,
  `promocode_id` int(10) UNSIGNED NOT NULL,
  `brand_id` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `promocode_usages`
--

CREATE TABLE `promocode_usages` (
  `id` int(10) UNSIGNED NOT NULL,
  `promocode_id` int(10) UNSIGNED NOT NULL,
  `client_id` int(11) NOT NULL,
  `order_id` int(11) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `roulette_account_state`
--

CREATE TABLE `roulette_account_state` (
  `client_id` bigint(20) UNSIGNED NOT NULL,
  `next_spin_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `roulette_payment_reservations`
--

CREATE TABLE `roulette_payment_reservations` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `spin_id` bigint(20) UNSIGNED NOT NULL,
  `order_id` bigint(20) UNSIGNED NOT NULL,
  `paynet_external_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime NOT NULL,
  `reserved_until` datetime NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `resolved_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `roulette_prizes`
--

CREATE TABLE `roulette_prizes` (
  `id` smallint(5) UNSIGNED NOT NULL,
  `code` varchar(40) NOT NULL,
  `titleRU` varchar(120) NOT NULL,
  `titleRO` varchar(120) NOT NULL,
  `reward_type` varchar(32) NOT NULL,
  `reward_value` decimal(10,2) DEFAULT NULL,
  `probability` decimal(5,2) DEFAULT NULL,
  `is_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `sort_order` smallint(6) NOT NULL DEFAULT 0,
  `updated_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `roulette_settings`
--

CREATE TABLE `roulette_settings` (
  `id` tinyint(3) UNSIGNED NOT NULL,
  `titleRU` varchar(120) NOT NULL,
  `titleRO` varchar(120) NOT NULL,
  `descriptionRU` text DEFAULT NULL,
  `descriptionRO` text DEFAULT NULL,
  `rulesRU` text DEFAULT NULL,
  `rulesRO` text DEFAULT NULL,
  `updated_at` datetime NOT NULL,
  `is_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `spin_interval_hours` int(10) UNSIGNED DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `roulette_spins`
--

CREATE TABLE `roulette_spins` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `client_id` bigint(20) UNSIGNED NOT NULL,
  `prize_id` smallint(5) UNSIGNED NOT NULL,
  `request_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `prize_code_snapshot` varchar(40) NOT NULL,
  `reward_type_snapshot` varchar(32) NOT NULL,
  `reward_value_snapshot` decimal(10,2) NOT NULL,
  `titleRU_snapshot` varchar(120) NOT NULL,
  `titleRO_snapshot` varchar(120) NOT NULL,
  `probability_snapshot` decimal(5,2) NOT NULL,
  `spun_at` datetime NOT NULL,
  `expires_at` datetime NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `order_id` bigint(20) UNSIGNED DEFAULT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `shop_cart_items`
--

CREATE TABLE `shop_cart_items` (
  `id` int(11) NOT NULL,
  `code` varchar(255) NOT NULL,
  `contact_id` int(11) DEFAULT NULL,
  `rowid` varchar(255) NOT NULL,
  `product_id` int(11) NOT NULL,
  `sku_id` int(11) DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `create_datetime` datetime NOT NULL DEFAULT current_timestamp(),
  `qty` int(11) NOT NULL,
  `price` decimal(15,4) DEFAULT NULL,
  `options` text CHARACTER SET utf8 COLLATE utf8_roman_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `shop_feature`
--

CREATE TABLE `shop_feature` (
  `id` int(11) NOT NULL,
  `GUID` varchar(128) NOT NULL,
  `type_id` int(11) NOT NULL,
  `name_RU` varchar(255) NOT NULL,
  `name_RO` varchar(255) NOT NULL,
  `name_EN` varchar(255) NOT NULL,
  `type` int(1) NOT NULL DEFAULT 0,
  `free_values` int(11) NOT NULL,
  `sorder` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `shop_feature_values`
--

CREATE TABLE `shop_feature_values` (
  `id` int(11) NOT NULL,
  `GUID` varchar(128) NOT NULL,
  `feature_id` int(11) NOT NULL,
  `name_RU` varchar(255) DEFAULT NULL,
  `name_RO` varchar(255) DEFAULT NULL,
  `name_EN` varchar(255) DEFAULT NULL,
  `color` varchar(10) NOT NULL DEFAULT '#ffffff',
  `sorder` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `shop_type`
--

CREATE TABLE `shop_type` (
  `id` int(11) NOT NULL,
  `GUID` varchar(128) NOT NULL,
  `name` varchar(255) NOT NULL,
  `sorder` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `site_feedback`
--

CREATE TABLE `site_feedback` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `feedback_type` enum('idea','bug','question') NOT NULL,
  `message` text NOT NULL,
  `page_path` varchar(255) DEFAULT NULL,
  `reference_url` varchar(2048) DEFAULT NULL,
  `locale` varchar(10) DEFAULT NULL,
  `status` enum('new','in_progress','done','rejected') NOT NULL DEFAULT 'new',
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `site_feedback_images`
--

CREATE TABLE `site_feedback_images` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `feedback_id` bigint(20) UNSIGNED NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `original_name` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `sliders`
--

CREATE TABLE `sliders` (
  `id` int(11) NOT NULL,
  `titleRU` varchar(250) DEFAULT NULL,
  `titleRO` varchar(250) DEFAULT NULL,
  `titleEN` varchar(255) DEFAULT NULL,
  `descRU` text NOT NULL,
  `descRO` text NOT NULL,
  `descEN` text NOT NULL,
  `infoRU` varchar(250) DEFAULT NULL,
  `infoRO` varchar(250) DEFAULT NULL,
  `infoEN` varchar(255) DEFAULT NULL,
  `buttonRU` varchar(64) DEFAULT NULL,
  `buttonRO` varchar(64) DEFAULT NULL,
  `buttonEN` varchar(64) DEFAULT NULL,
  `uriRU` varchar(300) NOT NULL,
  `uriRO` varchar(300) NOT NULL,
  `uriEN` varchar(300) NOT NULL,
  `ColorText` varchar(32) NOT NULL,
  `ColorButton` varchar(32) NOT NULL,
  `ColorButtonText` varchar(32) NOT NULL,
  `isShown` tinyint(1) NOT NULL DEFAULT 1,
  `sorder` int(11) NOT NULL DEFAULT 1,
  `img` varchar(255) DEFAULT NULL,
  `imgMob` varchar(254) NOT NULL,
  `youtube` varchar(254) DEFAULT NULL,
  `video` varchar(256) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `stores`
--

CREATE TABLE `stores` (
  `id` int(11) NOT NULL,
  `titleRU` varchar(250) DEFAULT NULL,
  `titleRO` varchar(250) DEFAULT NULL,
  `titleEN` varchar(255) DEFAULT NULL,
  `phone` varchar(255) DEFAULT NULL,
  `coords` varchar(255) DEFAULT NULL,
  `descRU` text NOT NULL,
  `descRO` text NOT NULL,
  `descEN` text NOT NULL,
  `textRU` text DEFAULT NULL,
  `textRO` text DEFAULT NULL,
  `textEN` text DEFAULT NULL,
  `iframe_google` varchar(1024) DEFAULT NULL,
  `delivery` int(11) NOT NULL,
  `isShown` tinyint(1) NOT NULL DEFAULT 1,
  `sorder` int(11) NOT NULL DEFAULT 1,
  `onBottom` int(11) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `stores_img`
--

CREATE TABLE `stores_img` (
  `id` int(11) NOT NULL,
  `stores_id` int(11) NOT NULL,
  `img` varchar(64) NOT NULL,
  `sorder` int(11) NOT NULL,
  `isShown` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `subscribe`
--

CREATE TABLE `subscribe` (
  `id` int(11) NOT NULL,
  `email` varchar(256) DEFAULT NULL,
  `active` varchar(256) DEFAULT NULL,
  `ip` varchar(255) NOT NULL,
  `send` varchar(256) DEFAULT NULL,
  `sorder` int(11) DEFAULT 0,
  `isShown` tinyint(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `subscriptions`
--

CREATE TABLE `subscriptions` (
  `id` int(11) NOT NULL,
  `email` varchar(256) DEFAULT NULL,
  `mailing` tinyint(1) DEFAULT 1,
  `sorder` int(11) DEFAULT 0,
  `isShown` tinyint(1) DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `vsl_logs`
--

CREATE TABLE `vsl_logs` (
  `id` bigint(11) NOT NULL,
  `type` varchar(100) NOT NULL,
  `text` mediumtext NOT NULL,
  `date` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Индексы сохранённых таблиц
--

--
-- Индексы таблицы `admins`
--
ALTER TABLE `admins`
  ADD PRIMARY KEY (`id`);

--
-- Индексы таблицы `analytics_events`
--
ALTER TABLE `analytics_events`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_analytics_events_event_uid` (`event_uid`),
  ADD KEY `idx_analytics_events_name_created` (`event_name`,`created_at`),
  ADD KEY `idx_analytics_events_visitor_created` (`visitor_key`,`created_at`),
  ADD KEY `idx_analytics_events_session_created` (`session_key`,`created_at`),
  ADD KEY `idx_analytics_events_cart_created` (`cart_key`,`created_at`),
  ADD KEY `idx_analytics_events_product_created` (`product_id`,`created_at`),
  ADD KEY `idx_analytics_events_category_created` (`category_id`,`created_at`),
  ADD KEY `idx_analytics_events_order` (`order_id`),
  ADD KEY `idx_analytics_events_source_created` (`traffic_source`,`created_at`),
  ADD KEY `idx_analytics_events_device_created` (`device_type`,`created_at`);

--
-- Индексы таблицы `articles`
--
ALTER TABLE `articles`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ID` (`id`);

--
-- Индексы таблицы `article_likes`
--
ALTER TABLE `article_likes`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_article_likes_visitor` (`article_id`,`visitor_key`),
  ADD KEY `idx_article_likes_article` (`article_id`);

--
-- Индексы таблицы `banners`
--
ALTER TABLE `banners`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ID` (`id`);

--
-- Индексы таблицы `brands`
--
ALTER TABLE `brands`
  ADD PRIMARY KEY (`id`),
  ADD KEY `id` (`id`);

--
-- Индексы таблицы `brand_certificates`
--
ALTER TABLE `brand_certificates`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_brand_certificates_brand` (`brand_id`),
  ADD KEY `idx_brand_certificates_visible_order` (`brand_id`,`isShown`,`sorder`);

--
-- Индексы таблицы `categories`
--
ALTER TABLE `categories`
  ADD PRIMARY KEY (`id`);

--
-- Индексы таблицы `category_banner`
--
ALTER TABLE `category_banner`
  ADD PRIMARY KEY (`id`),
  ADD KEY `category_id` (`category_id`),
  ADD KEY `idx_category_banner_category_id_id` (`category_id`,`id`);

--
-- Индексы таблицы `clients`
--
ALTER TABLE `clients`
  ADD PRIMARY KEY (`id`),
  ADD KEY `id_fb` (`id_fb`),
  ADD KEY `active` (`active`),
  ADD KEY `phone` (`phone`),
  ADD KEY `code` (`code`);

--
-- Индексы таблицы `collections`
--
ALTER TABLE `collections`
  ADD PRIMARY KEY (`id`);

--
-- Индексы таблицы `consent_events`
--
ALTER TABLE `consent_events`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_consent_client_channel` (`client_id`,`channel`),
  ADD KEY `idx_consent_created_at` (`created_at`);

--
-- Индексы таблицы `constants`
--
ALTER TABLE `constants`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `ID` (`id`);

--
-- Индексы таблицы `dates`
--
ALTER TABLE `dates`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ID` (`id`);

--
-- Индексы таблицы `delivery`
--
ALTER TABLE `delivery`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ID` (`id`);

--
-- Индексы таблицы `home_brand_sections`
--
ALTER TABLE `home_brand_sections`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_brand_sections_position` (`placement`,`isShown`,`sorder`);

--
-- Индексы таблицы `home_brand_section_products`
--
ALTER TABLE `home_brand_section_products`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_brand_section_product` (`section_id`,`product_id`),
  ADD KEY `idx_brand_section_products` (`section_id`,`isShown`,`sorder`),
  ADD KEY `idx_brand_product_id` (`product_id`);

--
-- Индексы таблицы `home_categories`
--
ALTER TABLE `home_categories`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_home_categories_visible_order` (`isShown`,`sorder`);

--
-- Индексы таблицы `home_product_items`
--
ALTER TABLE `home_product_items`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_home_section_product` (`section_key`,`product_id`),
  ADD KEY `idx_home_section_visible_order` (`section_key`,`isShown`,`sorder`),
  ADD KEY `idx_home_product_id` (`product_id`);

--
-- Индексы таблицы `menu`
--
ALTER TABLE `menu`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ID` (`id`);

--
-- Индексы таблицы `offers`
--
ALTER TABLE `offers`
  ADD PRIMARY KEY (`id`);

--
-- Индексы таблицы `offers_products`
--
ALTER TABLE `offers_products`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ID` (`id`);

--
-- Индексы таблицы `orders`
--
ALTER TABLE `orders`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_orders_promo_id` (`promo_id`),
  ADD KEY `idx_orders_promo_code` (`promo_code`);

--
-- Индексы таблицы `orders_products`
--
ALTER TABLE `orders_products`
  ADD PRIMARY KEY (`id`);

--
-- Индексы таблицы `paynet_logs`
--
ALTER TABLE `paynet_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ID` (`id`);

--
-- Индексы таблицы `personal_data_requests`
--
ALTER TABLE `personal_data_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_privacy_client_status` (`client_id`,`status`),
  ADD KEY `idx_privacy_created_at` (`created_at`);

--
-- Индексы таблицы `products`
--
ALTER TABLE `products`
  ADD PRIMARY KEY (`id`),
  ADD KEY `id` (`id`),
  ADD KEY `isShown` (`isShown`),
  ADD KEY `SKU` (`SKU`),
  ADD KEY `titleRU` (`titleRU`),
  ADD KEY `titleRO` (`titleRO`),
  ADD KEY `category_id` (`category_id`),
  ADD KEY `brand_id` (`brand_id`),
  ADD KEY `search_teg` (`search_teg`),
  ADD KEY `GUID` (`GUID`),
  ADD KEY `price` (`price`),
  ADD KEY `priceWH` (`priceWH`),
  ADD KEY `discount_price` (`discount_price`),
  ADD KEY `sex` (`sex`),
  ADD KEY `best_selling` (`best_selling`),
  ADD KEY `stock` (`stock`),
  ADD KEY `is_new` (`is_new`),
  ADD KEY `sorder` (`sorder`),
  ADD KEY `idx_products_shown_discount_price` (`isShown`,`discount_price`,`price`,`id`);

--
-- Индексы таблицы `products_features`
--
ALTER TABLE `products_features`
  ADD PRIMARY KEY (`id`);

--
-- Индексы таблицы `products_img`
--
ALTER TABLE `products_img`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ID` (`id`),
  ADD KEY `product_id` (`product_id`),
  ADD KEY `sorder` (`sorder`),
  ADD KEY `idx_product_image_order` (`product_id`,`sorder`,`id`);

--
-- Индексы таблицы `products_more`
--
ALTER TABLE `products_more`
  ADD UNIQUE KEY `product_id` (`product_id`,`related_id`);

--
-- Индексы таблицы `products_related`
--
ALTER TABLE `products_related`
  ADD UNIQUE KEY `product_id` (`product_id`,`related_id`);

--
-- Индексы таблицы `products_variable`
--
ALTER TABLE `products_variable`
  ADD PRIMARY KEY (`id`),
  ADD KEY `product_id` (`product_id`),
  ADD KEY `SKU` (`SKU`),
  ADD KEY `qty` (`qty`),
  ADD KEY `isShown` (`isShown`);

--
-- Индексы таблицы `products_variable_img`
--
ALTER TABLE `products_variable_img`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ID` (`id`),
  ADD KEY `product_id` (`product_id`),
  ADD KEY `variable_id` (`variable_id`);

--
-- Индексы таблицы `product_categories`
--
ALTER TABLE `product_categories`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_product_category` (`product_id`,`category_id`),
  ADD KEY `product_id` (`product_id`),
  ADD KEY `category_id` (`category_id`);

--
-- Индексы таблицы `product_import_changes`
--
ALTER TABLE `product_import_changes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_product_import_changes_created_at` (`created_at`),
  ADD KEY `idx_product_import_changes_product_id` (`product_id`),
  ADD KEY `idx_product_import_changes_action` (`action`),
  ADD KEY `idx_product_import_changes_status` (`status`);

--
-- Индексы таблицы `product_search`
--
ALTER TABLE `product_search`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_product` (`product_id`),
  ADD KEY `idx_variable` (`variable_id`);
ALTER TABLE `product_search` ADD FULLTEXT KEY `ft_search` (`title`,`SKU`,`GUID`,`color`,`volume`,`search_text`);

--
-- Индексы таблицы `promocodes`
--
ALTER TABLE `promocodes`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_promocodes_code` (`code`),
  ADD KEY `idx_promocodes_status` (`status`),
  ADD KEY `idx_promocodes_dates` (`starts_at`,`ends_at`);

--
-- Индексы таблицы `promocode_brands`
--
ALTER TABLE `promocode_brands`
  ADD PRIMARY KEY (`promocode_id`,`brand_id`),
  ADD KEY `idx_promocode_brands_brand_id` (`brand_id`);

--
-- Индексы таблицы `promocode_events`
--
ALTER TABLE `promocode_events`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_promocode_id` (`promocode_id`),
  ADD KEY `idx_client_id` (`client_id`),
  ADD KEY `idx_order_id` (`order_id`),
  ADD KEY `idx_code` (`code`),
  ADD KEY `idx_event_type` (`event_type`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Индексы таблицы `promocode_excluded_brands`
--
ALTER TABLE `promocode_excluded_brands`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_promocode_brand` (`promocode_id`,`brand_id`),
  ADD KEY `idx_promocode_excluded_promocode` (`promocode_id`),
  ADD KEY `idx_promocode_excluded_brand` (`brand_id`);

--
-- Индексы таблицы `promocode_usages`
--
ALTER TABLE `promocode_usages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_promo_usage_promocode` (`promocode_id`),
  ADD KEY `idx_promo_usage_client` (`client_id`),
  ADD KEY `idx_promo_usage_order` (`order_id`),
  ADD KEY `idx_promo_usage_client_promo` (`promocode_id`,`client_id`);

--
-- Индексы таблицы `roulette_account_state`
--
ALTER TABLE `roulette_account_state`
  ADD PRIMARY KEY (`client_id`);

--
-- Индексы таблицы `roulette_payment_reservations`
--
ALTER TABLE `roulette_payment_reservations`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_roulette_paynet_external_id` (`paynet_external_id`),
  ADD KEY `idx_roulette_reservation_spin_status` (`spin_id`,`status`,`reserved_until`),
  ADD KEY `idx_roulette_reservation_order` (`order_id`);

--
-- Индексы таблицы `roulette_prizes`
--
ALTER TABLE `roulette_prizes`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_roulette_prizes_code` (`code`),
  ADD KEY `idx_roulette_prizes_order` (`sort_order`,`id`);

--
-- Индексы таблицы `roulette_settings`
--
ALTER TABLE `roulette_settings`
  ADD PRIMARY KEY (`id`);

--
-- Индексы таблицы `roulette_spins`
--
ALTER TABLE `roulette_spins`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_roulette_spin_request` (`client_id`,`request_id`),
  ADD KEY `idx_roulette_spin_account_status_expiry` (`client_id`,`status`,`expires_at`),
  ADD KEY `idx_roulette_spin_order` (`order_id`);

--
-- Индексы таблицы `shop_cart_items`
--
ALTER TABLE `shop_cart_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `rowid` (`rowid`),
  ADD KEY `product_id` (`product_id`),
  ADD KEY `code` (`code`);

--
-- Индексы таблицы `shop_feature`
--
ALTER TABLE `shop_feature`
  ADD PRIMARY KEY (`id`);

--
-- Индексы таблицы `shop_feature_values`
--
ALTER TABLE `shop_feature_values`
  ADD PRIMARY KEY (`id`);

--
-- Индексы таблицы `shop_type`
--
ALTER TABLE `shop_type`
  ADD PRIMARY KEY (`id`);

--
-- Индексы таблицы `site_feedback`
--
ALTER TABLE `site_feedback`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_site_feedback_status_created` (`status`,`created_at`),
  ADD KEY `idx_site_feedback_type_created` (`feedback_type`,`created_at`);

--
-- Индексы таблицы `site_feedback_images`
--
ALTER TABLE `site_feedback_images`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_site_feedback_images_feedback` (`feedback_id`);

--
-- Индексы таблицы `sliders`
--
ALTER TABLE `sliders`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ID` (`id`);

--
-- Индексы таблицы `stores`
--
ALTER TABLE `stores`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ID` (`id`);

--
-- Индексы таблицы `stores_img`
--
ALTER TABLE `stores_img`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ID` (`id`);

--
-- Индексы таблицы `subscribe`
--
ALTER TABLE `subscribe`
  ADD PRIMARY KEY (`id`);

--
-- Индексы таблицы `subscriptions`
--
ALTER TABLE `subscriptions`
  ADD PRIMARY KEY (`id`);

--
-- Индексы таблицы `vsl_logs`
--
ALTER TABLE `vsl_logs`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT для сохранённых таблиц
--

--
-- AUTO_INCREMENT для таблицы `admins`
--
ALTER TABLE `admins`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `analytics_events`
--
ALTER TABLE `analytics_events`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `articles`
--
ALTER TABLE `articles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `article_likes`
--
ALTER TABLE `article_likes`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `banners`
--
ALTER TABLE `banners`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `brands`
--
ALTER TABLE `brands`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `brand_certificates`
--
ALTER TABLE `brand_certificates`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `categories`
--
ALTER TABLE `categories`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `category_banner`
--
ALTER TABLE `category_banner`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `clients`
--
ALTER TABLE `clients`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `collections`
--
ALTER TABLE `collections`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `consent_events`
--
ALTER TABLE `consent_events`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `constants`
--
ALTER TABLE `constants`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `dates`
--
ALTER TABLE `dates`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `delivery`
--
ALTER TABLE `delivery`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `home_brand_sections`
--
ALTER TABLE `home_brand_sections`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `home_brand_section_products`
--
ALTER TABLE `home_brand_section_products`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `home_categories`
--
ALTER TABLE `home_categories`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `home_product_items`
--
ALTER TABLE `home_product_items`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `menu`
--
ALTER TABLE `menu`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `offers`
--
ALTER TABLE `offers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `offers_products`
--
ALTER TABLE `offers_products`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `orders`
--
ALTER TABLE `orders`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `orders_products`
--
ALTER TABLE `orders_products`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `paynet_logs`
--
ALTER TABLE `paynet_logs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `personal_data_requests`
--
ALTER TABLE `personal_data_requests`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `products`
--
ALTER TABLE `products`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `products_features`
--
ALTER TABLE `products_features`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `products_img`
--
ALTER TABLE `products_img`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `products_variable`
--
ALTER TABLE `products_variable`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `products_variable_img`
--
ALTER TABLE `products_variable_img`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `product_categories`
--
ALTER TABLE `product_categories`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `product_import_changes`
--
ALTER TABLE `product_import_changes`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `product_search`
--
ALTER TABLE `product_search`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `promocodes`
--
ALTER TABLE `promocodes`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `promocode_events`
--
ALTER TABLE `promocode_events`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `promocode_excluded_brands`
--
ALTER TABLE `promocode_excluded_brands`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `promocode_usages`
--
ALTER TABLE `promocode_usages`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `roulette_payment_reservations`
--
ALTER TABLE `roulette_payment_reservations`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `roulette_prizes`
--
ALTER TABLE `roulette_prizes`
  MODIFY `id` smallint(5) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `roulette_spins`
--
ALTER TABLE `roulette_spins`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `shop_cart_items`
--
ALTER TABLE `shop_cart_items`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `shop_feature`
--
ALTER TABLE `shop_feature`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `shop_feature_values`
--
ALTER TABLE `shop_feature_values`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `shop_type`
--
ALTER TABLE `shop_type`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `site_feedback`
--
ALTER TABLE `site_feedback`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `site_feedback_images`
--
ALTER TABLE `site_feedback_images`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `sliders`
--
ALTER TABLE `sliders`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `stores`
--
ALTER TABLE `stores`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `stores_img`
--
ALTER TABLE `stores_img`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `subscribe`
--
ALTER TABLE `subscribe`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `subscriptions`
--
ALTER TABLE `subscriptions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `vsl_logs`
--
ALTER TABLE `vsl_logs`
  MODIFY `id` bigint(11) NOT NULL AUTO_INCREMENT;

--
-- Ограничения внешнего ключа сохраненных таблиц
--

--
-- Ограничения внешнего ключа таблицы `home_brand_section_products`
--
ALTER TABLE `home_brand_section_products`
  ADD CONSTRAINT `fk_brand_section_products_section` FOREIGN KEY (`section_id`) REFERENCES `home_brand_sections` (`id`) ON DELETE CASCADE;

--
-- Ограничения внешнего ключа таблицы `product_categories`
--
ALTER TABLE `product_categories`
  ADD CONSTRAINT `fk_pc_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_pc_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE;

--
-- Ограничения внешнего ключа таблицы `site_feedback_images`
--
ALTER TABLE `site_feedback_images`
  ADD CONSTRAINT `fk_site_feedback_images_feedback` FOREIGN KEY (`feedback_id`) REFERENCES `site_feedback` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
